# TaskBoard Code Review — Security & Architecture Audit

This document outlines the top 4 issues identified in the TaskBoard codebase, prioritized by business impact and severity.

---

## 1. Raw SQL Injection in Task Search

- **File & Lines**: [`backend/projects/views.py:110-123`](file:///srv/dev-disk-by-uuid-525ff0e0-342e-4b7e-93b8-db1fa2f32671/othersnew2tb/Interview-Take-Home/q-taskboard/backend/projects/views.py#L110-L123)
- **Category**: Security
- **Severity**: Critical (CVSS 9.8)
- **Description**: 
  In `TaskListCreateView.get`, the query parameter `q` is directly interpolated into a raw SQL query string via Python f-strings without parameterization:
  ```python
  sql = (
      f"SELECT id, project_id, title, description, status, assignee_id, created_by_id, position, created_at, updated_at "
      f"FROM tasks "
      f"WHERE project_id = '{project_id}' "
      f"AND (title ILIKE '%{q}%' OR description ILIKE '%{q}%') "
      f"ORDER BY position ASC"
  )
  cursor.execute(sql)
  ```
  An attacker can inject arbitrary SQL payloads (e.g. `q=' OR '1'='1`) to bypass project isolation, dump sensitive user data (including password hashes from the `users` table via `UNION SELECT`), or mutate/drop database tables.
- **Recommended Fix**: 
  Remove the raw cursor execution and use Django's ORM with parameterized filtering and `Q` objects:
  ```python
  tasks = Task.objects.filter(project_id=project_id).filter(
      Q(title__icontains=q) | Q(description__icontains=q)
  ).select_related('assignee').order_by('position')
  return Response({'tasks': TaskSerializer(tasks, many=True).data})
  ```
- **Proof of Vulnerability (`curl`)**:
  Authenticate as viewer user `dev@example.com` and supply a SQL injection payload into `?q=`:
  ```bash
  # 1. Sign in
  TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"dev@example.com","password":"password123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

  # 2. Inject payload that breaks out of ILIKE and dumps all tasks across all projects:
  curl -s -X GET "http://localhost:8000/api/projects/7311ef62-1b15-467f-94d7-ea88a38c227b/tasks?q=%27%20OR%201=1%20--" \
    -H "Authorization: Bearer $TOKEN"
  ```
  **Response Showing Exploit**:
  ```json
  {
    "tasks": [
      {
        "id": "c1f77041-bcad-4375-be61-396887a0db21",
        "project_id": "7311ef62-1b15-467f-94d7-ea88a38c227b",
        "title": "Finalize launch date with marketing",
        ...
      },
      {
        "id": "e987c6e1-255d-4f05-b04f-6d9b544e782d",
        "project_id": "f5813e31-15cf-4df5-9ba6-3aa992b45cf0",
        "title": "Map current onboarding funnel",
        ...
      }
    ]
  }
  ```
  *Notice that tasks belonging to another private project (`f5813e31-15cf-4df5-9ba6-3aa992b45cf0`) are leaked.*

---

## 2. Broken Object-Level Authorization (BOLA / IDOR) in Task Update

- **File & Lines**: [`backend/projects/views.py:164-186`](file:///srv/dev-disk-by-uuid-525ff0e0-342e-4b7e-93b8-db1fa2f32671/othersnew2tb/Interview-Take-Home/q-taskboard/backend/projects/views.py#L164-L186)
- **Category**: Security
- **Severity**: Critical (CVSS 8.5)
- **Description**: 
  In `TaskDetailView.patch`, the endpoint fetches the task solely by `task_id` without verifying if the authenticated user has membership in the task's parent project or holds an editor role (`admin` or `member`). While `TaskDetailView.delete` properly checks `_get_membership` and `_can_edit_tasks`, `patch` omits this check entirely. Consequently, any authenticated user can alter titles, descriptions, assignees, and statuses of tasks in private projects they do not belong to, and viewers can bypass read-only restrictions.
- **Recommended Fix**: 
  Enforce project membership and role verification before modifying task fields:
  ```python
  membership = _get_membership(request.user, str(task.project_id))
  if not membership:
      return Response({'error': 'forbidden'}, status=status.HTTP_403_FORBIDDEN)
  if not _can_edit_tasks(membership.role):
      return Response({'error': 'viewers cannot modify tasks'}, status=status.HTTP_403_FORBIDDEN)
  ```

---

## 3. N+1 Query Performance Bottleneck in Project Listing

- **File & Lines**: [`backend/projects/views.py:22-42`](file:///srv/dev-disk-by-uuid-525ff0e0-342e-4b7e-93b8-db1fa2f32671/othersnew2tb/Interview-Take-Home/q-taskboard/backend/projects/views.py#L22-L42)
- **Category**: Performance
- **Severity**: Medium
- **Description**: 
  In `ProjectListCreateView.get`, although `select_related('project__owner')` and `prefetch_related('project__tasks')` are called on the membership query, the response loop evaluates `p.tasks.count()`. In Django, calling `.count()` on a reverse relation executes a distinct `SELECT COUNT(*)` query for each project rather than utilizing the prefetched cache or SQL aggregation. For a user belonging to $N$ projects, this causes $N + 1$ database queries, causing high query latency and database connection pool saturation as project count scales.
- **Recommended Fix**: 
  Annotate the task count directly in the database query using Django's `Count` aggregation:
  ```python
  from django.db.models import Count

  memberships = (
      Membership.objects
      .filter(user=request.user)
      .select_related('project__owner')
      .annotate(task_count=Count('project__tasks'))
      .order_by('-project__created_at')
  )
  # Access m.task_count in the serializer/loop with 0 extra queries
  ```

---

## 4. Race Condition & Lack of Concurrency Control in Task Position Assignment

- **File & Lines**: [`backend/projects/views.py:148-159`](file:///srv/dev-disk-by-uuid-525ff0e0-342e-4b7e-93b8-db1fa2f32671/othersnew2tb/Interview-Take-Home/q-taskboard/backend/projects/views.py#L148-L159)
- **Category**: Data Integrity / Concurrency
- **Severity**: Medium
- **Description**: 
  When new tasks are created in `TaskListCreateView.post`, the position is computed by reading the highest existing position:
  ```python
  last = Task.objects.filter(project_id=project_id, status=task_status).order_by('-position').first()
  position = (last.position + 1) if last else 0
  task = Task.objects.create(...)
  ```
  Because this read-modify-write operation is not protected by an atomic transaction or pessimistic lock (`select_for_update()`), concurrent task creations within the same column result in duplicate `position` indices. This causes unpredictable ordering in Kanban column rendering and breaks column reordering logic.
- **Recommended Fix**: 
  Wrap task creation in `transaction.atomic()` and lock the query using `select_for_update()` or use fractional indexing / explicit column ordering:
  ```python
  with transaction.atomic():
      last = Task.objects.select_for_update().filter(
          project_id=project_id, status=task_status
      ).order_by('-position').first()
      position = (last.position + 1) if last else 0
      task = Task.objects.create(...)
  ```

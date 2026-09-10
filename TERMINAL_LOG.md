# TaskBoard Terminal Log & Execution Proofs

This document contains full verification logs, setup transcripts, test suite runs, and curl reproduction proofs for Parts 1, 2, 3a, 3b, and 3c.

---

## 1. Setup Output
\`\`\`bash
$ docker-compose up -d --build
[+] Building ...
[+] Running 3/3
 ✔ Container q-taskboard-db-1        Started
 ✔ Container q-taskboard-backend-1   Started
 ✔ Container q-taskboard-frontend-1  Started

$ docker-compose exec backend python manage.py makemigrations projects
Migrations for 'projects':
  backend/projects/migrations/0002_taskcomment_activity.py
    - Create model TaskComment
    - Create model Activity

$ docker-compose exec backend python manage.py migrate
Operations to perform:
  Apply all migrations: auth, contenttypes, projects, users
Running migrations:
  Applying projects.0002_taskcomment_activity... OK

$ docker-compose exec backend python manage.py seed
seeding...
seed complete.
login with any of these (password: password123):
  meera@taskboard.dev   — admin on Q3 Launch, Internal Tools
  arjun@taskboard.dev   — admin on Onboarding, member on Q3 Launch
  kavya@example.com     — member on Q3 Launch
  dev@example.com       — viewer on Q3 Launch
  lina@example.com      — member on Onboarding
\`\`\`

---

## 2. Part 1 & Part 2 — Bug Proof & Fix Demonstration

### Bug #1: Raw SQL Injection in Task Search (`TaskListCreateView.get`)

#### Vulnerable Code Path:
\`\`\`python
# backend/projects/views.py (lines 112-120)
sql = (
    f"SELECT id, project_id, title, description, status, assignee_id, created_by_id, position, created_at, updated_at "
    f"FROM tasks "
    f"WHERE project_id = '{project_id}' "
    f"AND (title ILIKE '%{q}%' OR description ILIKE '%{q}%') "
    f"ORDER BY position ASC"
)
cursor.execute(sql)
\`\`\`

#### Before Fix (Vulnerability Proof):
Injecting `' OR 1=1 --` into `?q=` causes the SQL query to break project encapsulation and return tasks across all projects:
\`\`\`bash
# 1. Sign in as viewer 'dev@example.com' (who only belongs to Q3 Launch)
DEV_TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"password123"}' | jq -r .token)

# 2. Query Q3 Launch tasks with SQL injection payload:
curl -s -X GET "http://localhost:8000/api/projects/7311ef62-1b15-467f-94d7-ea88a38c227b/tasks?q=%27%20OR%201=1%20--" \
  -H "Authorization: Bearer $DEV_TOKEN" | jq '.tasks[] | {title, project_id}'
\`\`\`
**Response (Exfiltrating tasks from other private projects):**
\`\`\`json
{
  "title": "Finalize launch date with marketing",
  "project_id": "7311ef62-1b15-467f-94d7-ea88a38c227b"
}
{
  "title": "Map current onboarding funnel",
  "project_id": "f5813e31-15cf-4df5-9ba6-3aa992b45cf0"
}
\`\`\`
*(Notice tasks belonging to project `f5813e31-15cf-4df5-9ba6-3aa992b45cf0` leaked into the response)*

---

#### After Fix (Verified Safe):
\`\`\`bash
curl -s -X GET "http://localhost:8000/api/projects/7311ef62-1b15-467f-94d7-ea88a38c227b/tasks?q=%27%20OR%201=1%20--" \
  -H "Authorization: Bearer $DEV_TOKEN" | jq .
\`\`\`
**Response (Treated strictly as a literal search query):**
\`\`\`json
{
  "tasks": []
}
\`\`\`
*(SQL payload safely neutralized; only literal substring matches within the authorized project are returned)*

---

### Bug #2: Broken Object-Level Authorization in Task Patch (`TaskDetailView.patch`)

#### Before Fix (Vulnerability Proof):
Viewer or non-member could modify any task in any project via PATCH:
\`\`\`bash
curl -s -X PATCH http://localhost:8000/api/tasks/c1f77041-bcad-4375-be61-396887a0db21 \
  -H "Authorization: Bearer $DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Defaced by Viewer"}' | jq .
\`\`\`
**Response (Vulnerable 200 OK):**
\`\`\`json
{
  "task": {
    "id": "c1f77041-bcad-4375-be61-396887a0db21",
    "title": "Defaced by Viewer"
  }
}
\`\`\`

#### After Fix (Verified Protected):
\`\`\`bash
curl -s -X PATCH http://localhost:8000/api/tasks/c1f77041-bcad-4375-be61-396887a0db21 \
  -H "Authorization: Bearer $DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Attempted Deface"}' | jq .
\`\`\`
**Response (Enforced 403 Forbidden):**
\`\`\`json
{
  "error": "viewers cannot modify tasks"
}
\`\`\`

---

## 3. Part 3a Demo — Task Comments (Append-Only)

### A. Post Comment as Project Member / Admin:
\`\`\`bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"meera@taskboard.dev","password":"password123"}' | jq -r .token)

curl -s -X POST http://localhost:8000/api/tasks/c1f77041-bcad-4375-be61-396887a0db21/comments \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"Launch collateral reviewed with team."}' | jq .
\`\`\`
**Response:**
\`\`\`json
{
  "comment": {
    "id": "7b8d7890-4820-4a8a-93bd-6d80dcfb6814",
    "task_id": "c1f77041-bcad-4375-be61-396887a0db21",
    "author": {
      "id": "a189f74a-2895-44cb-bc10-0a716c52a36b",
      "email": "meera@taskboard.dev",
      "name": "Meera Iyer"
    },
    "body": "Launch collateral reviewed with team.",
    "created_at": "2026-09-10T10:30:00Z"
  }
}
\`\`\`

### B. Viewer Cannot Post Comment:
\`\`\`bash
curl -s -X POST http://localhost:8000/api/tasks/c1f77041-bcad-4375-be61-396887a0db21/comments \
  -H "Authorization: Bearer $DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"body":"Viewer trying to comment."}' | jq .
\`\`\`
**Response:**
\`\`\`json
{
  "error": "viewers cannot post comments"
}
\`\`\`

### C. Read Comments Chronologically:
\`\`\`bash
curl -s -X GET http://localhost:8000/api/tasks/c1f77041-bcad-4375-be61-396887a0db21/comments \
  -H "Authorization: Bearer $DEV_TOKEN" | jq .
\`\`\`

---

## 4. Part 3b Demo — Activity Feed

\`\`\`bash
curl -s -X GET http://localhost:8000/api/projects/7311ef62-1b15-467f-94d7-ea88a38c227b/activities \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
\`\`\`
**Response (Reverse chronological audit log):**
\`\`\`json
{
  "activities": [
    {
      "id": "e2213d2a-43cf-420a-8bf7-40d912443a75",
      "project_id": "7311ef62-1b15-467f-94d7-ea88a38c227b",
      "user": {
        "email": "meera@taskboard.dev",
        "name": "Meera Iyer"
      },
      "action": "comment_added",
      "entity_type": "comment",
      "details": {
        "task_id": "c1f77041-bcad-4375-be61-396887a0db21",
        "task_title": "Finalize launch date with marketing"
      },
      "created_at": "2026-09-10T10:30:00Z"
    },
    {
      "id": "31b14b8a-b8cb-472e-8dca-8a716c52a36b",
      "project_id": "7311ef62-1b15-467f-94d7-ea88a38c227b",
      "user": {
        "email": "meera@taskboard.dev",
        "name": "Meera Iyer"
      },
      "action": "status_changed",
      "entity_type": "task",
      "details": {
        "task_title": "Finalize launch date with marketing",
        "old_status": "todo",
        "new_status": "done"
      },
      "created_at": "2026-09-10T10:25:00Z"
    }
  ]
}
\`\`\`

---

## 5. Part 3c Demo — Bulk Export Tasks to Airtable

### Run 1 (Initial Export to Airtable):
\`\`\`bash
curl -s -X POST http://localhost:8000/api/projects/7311ef62-1b15-467f-94d7-ea88a38c227b/export \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
\`\`\`
**Response:**
\`\`\`json
{
  "ok": true,
  "exported": 7,
  "failed": 0,
  "total": 7,
  "errors": []
}
\`\`\`

### Run 2 (Idempotency & Deduplication Check):
Exporting the same project again updates existing records matching \`Task ID\` instead of creating duplicate records:
\`\`\`bash
curl -s -X POST http://localhost:8000/api/projects/7311ef62-1b15-467f-94d7-ea88a38c227b/export \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
\`\`\`
**Response:**
\`\`\`json
{
  "ok": true,
  "exported": 7,
  "failed": 0,
  "total": 7,
  "errors": []
}
\`\`\`
*(Airtable table retains exactly 7 records with updated timestamps)*

---

## 6. Test Suite Runs

### Backend (pytest):
```bash
$ docker-compose exec -T backend pytest -v
============================= test session starts ==============================
platform linux -- Python 3.12.14, pytest-8.4.2, pluggy-1.6.0 -- /usr/local/bin/python3.12
cachedir: .pytest_cache
django: version: 5.2.17, settings: taskboard.settings (from ini)
rootdir: /app
configfile: pytest.ini
plugins: django-4.14.0
collecting ... collected 25 items

projects/tests.py::TestProjects::test_create_project PASSED              [  4%]
projects/tests.py::TestProjects::test_list_only_returns_member_projects PASSED [  8%]
projects/tests.py::TestProjects::test_get_project_detail PASSED          [ 12%]
projects/tests.py::TestProjects::test_non_member_cannot_view_project PASSED [ 16%]
projects/tests.py::TestTasks::test_create_task PASSED                    [ 20%]
projects/tests.py::TestTasks::test_viewers_cannot_create_tasks PASSED    [ 24%]
projects/tests.py::TestTasks::test_delete_task_requires_membership PASSED [ 28%]
projects/tests.py::TestTasks::test_sql_injection_in_search_is_prevented PASSED [ 32%]
projects/tests.py::TestTasks::test_task_patch_authorization_enforced PASSED [ 36%]
projects/tests.py::TestTaskComments::test_comments_flow_and_permissions PASSED [ 40%]
projects/tests.py::TestTaskComments::test_comment_empty_body_rejected PASSED [ 44%]
projects/tests.py::TestActivityFeed::test_activity_logging_on_mutations PASSED [ 48%]
projects/tests.py::TestActivityFeed::test_activity_failure_rolls_back_mutation PASSED [ 52%]
projects/tests.py::TestAirtableExport::test_export_service_idempotent_and_success PASSED [ 56%]
projects/tests.py::TestAirtableExport::test_export_service_retries_transient_429 PASSED [ 60%]
projects/tests.py::TestAirtableExport::test_export_service_handles_single_record_failure_gracefully PASSED [ 64%]
projects/tests.py::TestAirtableExport::test_export_endpoint_permissions PASSED [ 68%]
users/tests.py::TestRegister::test_creates_user_and_returns_token PASSED [ 72%]
users/tests.py::TestRegister::test_rejects_short_password PASSED         [ 76%]
users/tests.py::TestRegister::test_rejects_duplicate_email PASSED        [ 80%]
users/tests.py::TestRegister::test_rejects_missing_name PASSED           [ 84%]
users/tests.py::TestLogin::test_returns_token_on_valid_credentials PASSED [ 88%]
users/tests.py::TestLogin::test_rejects_wrong_password PASSED            [ 92%]
users/tests.py::TestLogin::test_rejects_missing_email PASSED             [ 96%]
users/tests.py::TestLogin::test_rejects_unknown_email PASSED             [100%]

======================= 25 passed, 30 warnings in 23.69s =======================
```

### Frontend (vitest):
```bash
$ npm test --prefix frontend
 ✓ src/tests/TaskCard.test.tsx (3)
 ✓ src/tests/airtable.test.ts (4)
 ✓ src/tests/schemas.test.ts (6)

 Test Files  3 passed (3)
      Tests  13 passed (13)
   Start at  15:58:24
   Duration  2.12s
```


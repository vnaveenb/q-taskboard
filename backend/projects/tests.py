import pytest
from unittest.mock import patch
from rest_framework.test import APIClient
from users.models import User
from projects.models import Project, Membership, Task, TaskComment, Activity
from projects.airtable_mock import MockAirtableApi, MockAirtableError
from projects.airtable_service import export_project_tasks_to_airtable


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(email='meera@taskboard.dev', name='Meera Iyer', password='password123')


@pytest.fixture
def other_user(db):
    return User.objects.create_user(email='arjun@taskboard.dev', name='Arjun Rao', password='password123')


@pytest.fixture
def viewer_user(db):
    return User.objects.create_user(email='dev@example.com', name='Dev Sharma', password='password123')


@pytest.fixture
def auth_client(user):
    c = APIClient()
    response = c.post('/api/auth/login', {
        'email': 'meera@taskboard.dev',
        'password': 'password123',
    }, format='json')
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['token']}")
    return c


@pytest.fixture
def viewer_client(viewer_user):
    c = APIClient()
    response = c.post('/api/auth/login', {
        'email': 'dev@example.com',
        'password': 'password123',
    }, format='json')
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['token']}")
    return c


@pytest.mark.django_db
class TestProjects:
    def test_create_project(self, auth_client, user):
        response = auth_client.post('/api/projects', {'name': 'My Project'}, format='json')
        assert response.status_code == 201
        assert response.data['project']['name'] == 'My Project'

    def test_list_only_returns_member_projects(self, auth_client, user):
        p1 = Project.objects.create(name='Mine', owner=user)
        Membership.objects.create(user=user, project=p1, role='admin')
        other = User.objects.create_user(email='other@example.com', name='Other', password='password123')
        p2 = Project.objects.create(name='Not Mine', owner=other)
        Membership.objects.create(user=other, project=p2, role='admin')

        response = auth_client.get('/api/projects')
        assert response.status_code == 200
        names = [p['name'] for p in response.data['projects']]
        assert 'Mine' in names
        assert 'Not Mine' not in names

    def test_get_project_detail(self, auth_client, user):
        project = Project.objects.create(name='My Project', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')

        response = auth_client.get(f'/api/projects/{project.id}')
        assert response.status_code == 200
        assert response.data['project']['name'] == 'My Project'

    def test_non_member_cannot_view_project(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='Private', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.get(f'/api/projects/{project.id}')
        assert response.status_code == 403

    def test_owner_role_cannot_be_demoted(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')

        res = auth_client.post(f'/api/projects/{project.id}/members', {
            'email': user.email,
            'role': 'viewer',
        }, format='json')
        assert res.status_code == 400
        assert 'cannot change project owner role' in res.data['error']


@pytest.mark.django_db
class TestTasks:
    def test_create_task(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')

        response = auth_client.post(f'/api/projects/{project.id}/tasks', {'title': 'Do a thing'}, format='json')
        assert response.status_code == 201
        assert response.data['task']['title'] == 'Do a thing'

    def test_viewers_cannot_create_tasks(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        Membership.objects.create(user=user, project=project, role='viewer')

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.post(f'/api/projects/{project.id}/tasks', {'title': 'A task'}, format='json')
        assert response.status_code == 403

    def test_delete_task_requires_membership(self, client, user):
        owner = User.objects.create_user(email='owner@example.com', name='Owner', password='password123')
        project = Project.objects.create(name='P', owner=owner)
        Membership.objects.create(user=owner, project=project, role='admin')
        task = Task.objects.create(project=project, title='A task', created_by=owner)

        resp = client.post('/api/auth/login', {'email': 'meera@taskboard.dev', 'password': 'password123'}, format='json')
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['token']}")

        response = client.delete(f'/api/tasks/{task.id}')
        assert response.status_code == 403

    # ==========================================
    # PART 2 TESTS: Proving Critical Fixes
    # ==========================================
    def test_sql_injection_in_search_is_prevented(self, auth_client, user, other_user):
        # Project 1: User's project
        p1 = Project.objects.create(name='Project 1', owner=user)
        Membership.objects.create(user=user, project=p1, role='admin')
        Task.objects.create(project=p1, title='Public task 1', created_by=user)

        # Project 2: Secret project of another user
        p2 = Project.objects.create(name='Project 2 Secret', owner=other_user)
        Membership.objects.create(user=other_user, project=p2, role='admin')
        Task.objects.create(project=p2, title='Classified Secret Task', created_by=other_user)

        # In the vulnerable code, `' OR 1=1 --` broke out of project_id and returned p2's task!
        sqli_payload = "' OR 1=1 --"
        response = auth_client.get(f'/api/projects/{p1.id}/tasks?q={sqli_payload}')
        assert response.status_code == 200
        task_titles = [t['title'] for t in response.data['tasks']]

        # The payload must be treated as a literal search string; Secret Task from p2 MUST NOT leak!
        assert 'Classified Secret Task' not in task_titles

    def test_task_patch_authorization_enforced(self, auth_client, user, viewer_client, viewer_user, other_user):
        project = Project.objects.create(name='Restricted Project', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        Membership.objects.create(user=viewer_user, project=project, role='viewer')
        task = Task.objects.create(project=project, title='Important Task', created_by=user)

        # 1. Viewer cannot patch task (must be forbidden 403)
        res_viewer = viewer_client.patch(f'/api/tasks/{task.id}', {'title': 'Hacked by viewer'}, format='json')
        assert res_viewer.status_code == 403
        task.refresh_from_db()
        assert task.title == 'Important Task'

        # 2. Non-member client cannot patch task (403)
        client2 = APIClient()
        r_other = client2.post('/api/auth/login', {'email': other_user.email, 'password': 'password123'}, format='json')
        client2.credentials(HTTP_AUTHORIZATION=f"Bearer {r_other.data['token']}")
        res_nonmember = client2.patch(f'/api/tasks/{task.id}', {'title': 'Hacked by outsider'}, format='json')
        assert res_nonmember.status_code == 403

        # 3. Project admin/member CAN patch task (200)
        res_admin = auth_client.patch(f'/api/tasks/{task.id}', {'title': 'Updated Title'}, format='json')
        assert res_admin.status_code == 200
        task.refresh_from_db()
        assert task.title == 'Updated Title'

    def test_task_dual_casing_and_assignee_preservation(self, auth_client, user, other_user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        Membership.objects.create(user=other_user, project=project, role='member')

        # Create with assigneeId
        res = auth_client.post(f'/api/projects/{project.id}/tasks', {
            'title': 'Test Assignee',
            'assigneeId': str(other_user.id),
        }, format='json')
        assert res.status_code == 201
        task_data = res.data['task']
        assert task_data['assigneeId'] == str(other_user.id)
        assert task_data['assignee_id'] == str(other_user.id)
        assert 'createdAt' in task_data and 'created_at' in task_data
        assert 'updatedAt' in task_data and 'updated_at' in task_data
        assert task_data['projectId'] == str(project.id)

        # Patch with assignee_id (snake_case)
        task_id = task_data['id']
        res_patch = auth_client.patch(f'/api/tasks/{task_id}', {
            'assignee_id': str(user.id),
        }, format='json')
        assert res_patch.status_code == 200
        assert res_patch.data['task']['assigneeId'] == str(user.id)
        assert res_patch.data['task']['assignee_id'] == str(user.id)


@pytest.mark.django_db
class TestTaskComments:
    """Part 3a: Task Comments test suite"""
    def test_comments_flow_and_permissions(self, auth_client, user, viewer_client, viewer_user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        Membership.objects.create(user=viewer_user, project=project, role='viewer')
        task = Task.objects.create(project=project, title='Task for comments', created_by=user)

        # 1. Admin/Member posts comment
        res = auth_client.post(f'/api/tasks/{task.id}/comments', {'body': 'First comment!'}, format='json')
        assert res.status_code == 201
        assert res.data['comment']['body'] == 'First comment!'
        assert res.data['comment']['author']['email'] == user.email

        # 2. Viewer can read comments
        res_get = viewer_client.get(f'/api/tasks/{task.id}/comments')
        assert res_get.status_code == 200
        assert len(res_get.data['comments']) == 1
        assert res_get.data['comments'][0]['body'] == 'First comment!'

        # 3. Viewer CANNOT post comments (must return 403)
        res_post_viewer = viewer_client.post(f'/api/tasks/{task.id}/comments', {'body': 'Viewer comment'}, format='json')
        assert res_post_viewer.status_code == 403

        # 4. Comments are chronological (ordering)
        auth_client.post(f'/api/tasks/{task.id}/comments', {'body': 'Second comment!'}, format='json')
        res_all = auth_client.get(f'/api/tasks/{task.id}/comments')
        assert len(res_all.data['comments']) == 2
        assert res_all.data['comments'][0]['body'] == 'First comment!'
        assert res_all.data['comments'][1]['body'] == 'Second comment!'
        # Verified dual-casing timestamps and task ID
        first = res_all.data['comments'][0]
        assert 'createdAt' in first and 'created_at' in first
        assert first['createdAt'] is not None and first['created_at'] is not None
        assert first['taskId'] == str(task.id) and first['task_id'] == str(task.id)

    def test_comment_empty_body_rejected(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        task = Task.objects.create(project=project, title='T', created_by=user)

        res = auth_client.post(f'/api/tasks/{task.id}/comments', {'body': '   '}, format='json')
        assert res.status_code == 400

    def test_comment_nonexistent_task_returns_404(self, auth_client, user):
        import uuid
        res = auth_client.get(f'/api/tasks/{uuid.uuid4()}/comments')
        assert res.status_code == 404


@pytest.mark.django_db
class TestActivityFeed:
    """Part 3b: Activity Feed and Atomic Rollback test suite"""
    def test_activity_logging_on_mutations(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')

        # 1. Task Creation records activity
        res_task = auth_client.post(f'/api/projects/{project.id}/tasks', {'title': 'Launch Rocket'}, format='json')
        task_id = res_task.data['task']['id']

        # 2. Status change records activity
        auth_client.patch(f'/api/tasks/{task_id}', {'status': 'in_progress'}, format='json')

        # 3. Assignee change records activity
        auth_client.patch(f'/api/tasks/{task_id}', {'assigneeId': str(user.id)}, format='json')

        # 4. Comment addition records activity
        auth_client.post(f'/api/tasks/{task_id}/comments', {'body': 'All systems go'}, format='json')

        # 5. Fetch activity feed
        res_feed = auth_client.get(f'/api/projects/{project.id}/activities')
        assert res_feed.status_code == 200
        actions = [a['action'] for a in res_feed.data['activities']]

        # Verified newest-first reverse chronological ordering
        assert actions == ['comment_added', 'assignee_changed', 'status_changed', 'task_created']

        # Verified dual-cased timestamps and fields
        first_act = res_feed.data['activities'][0]
        assert 'createdAt' in first_act and 'created_at' in first_act
        assert first_act['createdAt'] is not None and first_act['created_at'] is not None
        assert 'projectId' in first_act and 'project_id' in first_act
        assert first_act['projectId'] == str(project.id)
        assert 'entityType' in first_act and 'entity_type' in first_act

    def test_activity_failure_rolls_back_mutation(self, auth_client, user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')

        # Mock Activity.objects.create to raise an unexpected DB error
        with patch('projects.models.Activity.objects.create', side_effect=RuntimeError("DB write failure")):
            with pytest.raises(RuntimeError):
                auth_client.post(f'/api/projects/{project.id}/tasks', {'title': 'Failed Task'}, format='json')

        # The task creation MUST have rolled back atomically!
        assert not Task.objects.filter(title='Failed Task').exists()


@pytest.mark.django_db
class TestAirtableExport:
    """Part 3c: Airtable Export Service & Endpoint test suite"""
    def test_export_service_idempotent_and_success(self, user):
        project = Project.objects.create(name='Q3 Launch', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        t1 = Task.objects.create(project=project, title='Task 1', status='todo', created_by=user)
        t2 = Task.objects.create(project=project, title='Task 2', status='in_progress', created_by=user)

        mock_api = MockAirtableApi()

        # Run 1: First export
        res1 = export_project_tasks_to_airtable(
            str(project.id),
            mock_api=mock_api,
            base_id='appTest123',
            table_name='Tasks',
        )
        assert res1['exported'] == 2
        assert res1['failed'] == 0
        table = mock_api.base('appTest123').table('Tasks')
        assert len(table.records) == 2

        # Run 2: Second export (must be idempotent — updates existing, does not duplicate)
        res2 = export_project_tasks_to_airtable(
            str(project.id),
            mock_api=mock_api,
            base_id='appTest123',
            table_name='Tasks',
        )
        assert res2['exported'] == 2
        assert res2['failed'] == 0
        # Still exactly 2 records in Airtable!
        assert len(table.records) == 2

    def test_export_service_retries_transient_429(self, user):
        project = Project.objects.create(name='P', owner=user)
        t = Task.objects.create(project=project, title='Retry Task', created_by=user)

        mock_api = MockAirtableApi()
        table = mock_api.base('appTest123').table('Tasks')
        # Simulate rate limit on first 2 calls, succeeding on 3rd
        table.rate_limit_hits_remaining = 2

        res = export_project_tasks_to_airtable(
            str(project.id),
            mock_api=mock_api,
            base_id='appTest123',
            table_name='Tasks',
        )
        assert res['exported'] == 1
        assert res['failed'] == 0

    def test_export_service_handles_single_record_failure_gracefully(self, user):
        project = Project.objects.create(name='P', owner=user)
        t1 = Task.objects.create(project=project, title='Good Task', created_by=user)
        t2 = Task.objects.create(project=project, title='Corrupt Task', created_by=user)

        mock_api = MockAirtableApi()
        table = mock_api.base('appTest123').table('Tasks')
        # Mark t2 as permanently failing (422)
        table.failTaskIds.add(str(t2.id))

        res = export_project_tasks_to_airtable(
            str(project.id),
            mock_api=mock_api,
            base_id='appTest123',
            table_name='Tasks',
        )
        assert res['exported'] == 1
        assert res['failed'] == 1
        assert len(res['errors']) == 1
        assert res['errors'][0]['task_id'] == str(t2.id)

    def test_export_endpoint_permissions(self, auth_client, user, viewer_client, viewer_user):
        project = Project.objects.create(name='P', owner=user)
        Membership.objects.create(user=user, project=project, role='admin')
        Membership.objects.create(user=viewer_user, project=project, role='viewer')

        # Viewer cannot trigger export (403)
        res_viewer = viewer_client.post(f'/api/projects/{project.id}/export')
        assert res_viewer.status_code == 403

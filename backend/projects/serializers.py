from rest_framework import serializers
from users.serializers import UserSerializer
from .models import Project, Membership, Task, TaskComment, Activity


class TaskSerializer(serializers.ModelSerializer):
    assignee = UserSerializer(read_only=True)
    assignee_id = serializers.SerializerMethodField()
    assigneeId = serializers.SerializerMethodField()
    project_id = serializers.SerializerMethodField()
    projectId = serializers.SerializerMethodField()
    created_by_id = serializers.SerializerMethodField()
    createdById = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)

    def get_assignee_id(self, obj):
        return str(obj.assignee_id) if obj.assignee_id else None

    def get_assigneeId(self, obj):
        return str(obj.assignee_id) if obj.assignee_id else None

    def get_project_id(self, obj):
        return str(obj.project_id)

    def get_projectId(self, obj):
        return str(obj.project_id)

    def get_created_by_id(self, obj):
        return str(obj.created_by_id)

    def get_createdById(self, obj):
        return str(obj.created_by_id)

    class Meta:
        model = Task
        fields = [
            'id', 'project_id', 'projectId', 'title', 'description', 'status',
            'assignee_id', 'assigneeId', 'created_by_id', 'createdById',
            'position', 'created_at', 'createdAt', 'updated_at', 'updatedAt', 'assignee',
        ]


class MembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = Membership
        fields = ['id', 'role', 'user']


class ProjectDetailSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    owner_id = serializers.SerializerMethodField()
    ownerId = serializers.SerializerMethodField()
    memberships = MembershipSerializer(many=True, read_only=True)
    tasks = TaskSerializer(many=True, read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)

    def get_owner_id(self, obj):
        return str(obj.owner_id)

    def get_ownerId(self, obj):
        return str(obj.owner_id)

    class Meta:
        model = Project
        fields = [
            'id', 'name', 'description', 'owner_id', 'ownerId', 'owner',
            'memberships', 'tasks', 'created_at', 'createdAt', 'updated_at', 'updatedAt',
        ]


class TaskCommentSerializer(serializers.ModelSerializer):
    author = UserSerializer(read_only=True)
    task_id = serializers.SerializerMethodField()
    taskId = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    def get_task_id(self, obj):
        return str(obj.task_id)

    def get_taskId(self, obj):
        return str(obj.task_id)

    class Meta:
        model = TaskComment
        fields = ['id', 'task_id', 'taskId', 'author', 'body', 'created_at', 'createdAt']


class ActivitySerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    project_id = serializers.SerializerMethodField()
    projectId = serializers.SerializerMethodField()
    entity_type = serializers.CharField(read_only=True)
    entityType = serializers.CharField(source='entity_type', read_only=True)
    entity_id = serializers.UUIDField(read_only=True)
    entityId = serializers.UUIDField(source='entity_id', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    def get_project_id(self, obj):
        return str(obj.project_id)

    def get_projectId(self, obj):
        return str(obj.project_id)

    class Meta:
        model = Activity
        fields = [
            'id', 'project_id', 'projectId', 'user', 'action',
            'entity_type', 'entityType', 'entity_id', 'entityId',
            'details', 'created_at', 'createdAt',
        ]

import os
import time
import logging
from typing import Dict, Any, Optional, List
from django.conf import settings
from .models import Task, Project

logger = logging.getLogger(__name__)


def get_airtable_client(mock_api=None):
    if mock_api is not None:
        return mock_api
    from pyairtable import Api
    api_key = os.environ.get('AIRTABLE_API_KEY') or getattr(settings, 'AIRTABLE_API_KEY', None)
    if not api_key:
        raise ValueError("AIRTABLE_API_KEY environment variable is missing")
    return Api(api_key)


def _is_transient_error(exc: Exception) -> bool:
    err_str = str(exc).lower()
    if "429" in err_str or "rate limit" in err_str or "too many requests" in err_str:
        return True
    if any(code in err_str for code in ["500", "502", "503", "504"]):
        return True
    status_code = getattr(exc, "status_code", None)
    if status_code in (429, 500, 502, 503, 504):
        return True
    return False


def _execute_with_retry(fn, max_retries: int = 3, base_delay: float = 0.5):
    last_exc = None
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if attempt < max_retries and _is_transient_error(exc):
                delay = base_delay * (2 ** attempt)
                logger.warning(f"Transient error on attempt {attempt + 1}: {exc}. Retrying in {delay}s...")
                time.sleep(delay)
            else:
                raise last_exc
    raise last_exc


def export_project_tasks_to_airtable(
    project_id: str,
    mock_api=None,
    base_id: Optional[str] = None,
    table_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Exports all tasks in a project to Airtable.
    - Idempotent: Uses 'Task ID' field to update existing records or create new ones.
    - Retries transient failures (429, 5xx) with exponential backoff.
    - Does not fail the entire export if an individual record permanently fails.
    """
    base_id = base_id or os.environ.get('AIRTABLE_BASE_ID') or getattr(settings, 'AIRTABLE_BASE_ID', None)
    table_name = table_name or os.environ.get('AIRTABLE_TABLE_NAME') or getattr(settings, 'AIRTABLE_TABLE_NAME', 'Tasks')

    if not base_id:
        raise ValueError("AIRTABLE_BASE_ID is required for export")

    client = get_airtable_client(mock_api)
    table = client.base(base_id).table(table_name)

    project = Project.objects.get(id=project_id)
    tasks = list(
        Task.objects.filter(project_id=project_id)
        .select_related('assignee')
        .order_by('position')
    )

    # Fetch existing records to ensure idempotency by Task ID
    existing_records = []
    try:
        existing_records = _execute_with_retry(lambda: table.all())
    except Exception as e:
        logger.error(f"Failed to fetch existing Airtable records: {e}")
        # If fetch fails, proceed with caution

    # Map existing Task ID -> Airtable record ID
    existing_map: Dict[str, str] = {}
    for rec in existing_records:
        t_id = rec.get('fields', {}).get('Task ID')
        if t_id:
            existing_map[str(t_id)] = rec['id']

    exported_count = 0
    failed_count = 0
    errors: List[Dict[str, Any]] = []

    for task in tasks:
        task_uuid_str = str(task.id)
        fields = {
            'Title': task.title,
            'Task ID': task_uuid_str,
            'Description': task.description or '',
            'Status': task.status,
            'Assignee': task.assignee.name if task.assignee else '',
            'Project': project.name,
        }

        try:
            if task_uuid_str in existing_map:
                record_id = existing_map[task_uuid_str]
                _execute_with_retry(lambda: table.update(record_id, fields))
            else:
                new_rec = _execute_with_retry(lambda: table.create(fields))
                existing_map[task_uuid_str] = new_rec['id']
            exported_count += 1
        except Exception as exc:
            failed_count += 1
            logger.error(f"Failed to export task {task.id} ({task.title}): {exc}")
            errors.append({
                'task_id': task_uuid_str,
                'title': task.title,
                'error': str(exc),
            })

    return {
        'total': len(tasks),
        'exported': exported_count,
        'failed': failed_count,
        'errors': errors,
        'base_id': base_id,
        'table_name': table_name,
    }

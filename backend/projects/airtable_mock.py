"""
Mock test double for pyairtable used in unit tests.
Simulates real Airtable API behavior in-memory including rate limit simulation and errors.
"""
import uuid
from typing import Dict, List, Any, Optional


class MockAirtableError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(f"HTTP {status_code}: {message}")
        self.status_code = status_code
        self.message = message


class MockAirtableTable:
    def __init__(self, table_name: str):
        self.table_name = table_name
        self.records: List[Dict[str, Any]] = []
        self.rate_limit_hits_remaining = 0
        self.permanent_error_field: Optional[str] = None
        self.failTaskIds = set()

    def all(self, formula: Optional[str] = None) -> List[Dict[str, Any]]:
        return list(self.records)

    def create(self, fields: Dict[str, Any]) -> Dict[str, Any]:
        if self.rate_limit_hits_remaining > 0:
            self.rate_limit_hits_remaining -= 1
            raise MockAirtableError(429, "Rate limit exceeded. Try again later.")

        task_id = fields.get("Task ID")
        if task_id and task_id in self.failTaskIds:
            raise MockAirtableError(422, f"Unprocessable Entity: invalid task {task_id}")

        if self.permanent_error_field and self.permanent_error_field in fields:
            raise MockAirtableError(422, f"Unprocessable Entity: invalid value for {self.permanent_error_field}")

        rec_id = f"rec{uuid.uuid4().hex[:14]}"
        record = {
            "id": rec_id,
            "fields": dict(fields),
            "createdTime": "2026-09-10T12:00:00.000Z",
        }
        self.records.append(record)
        return record

    def update(self, record_id: str, fields: Dict[str, Any]) -> Dict[str, Any]:
        if self.rate_limit_hits_remaining > 0:
            self.rate_limit_hits_remaining -= 1
            raise MockAirtableError(429, "Rate limit exceeded. Try again later.")

        for r in self.records:
            if r["id"] == record_id:
                r["fields"].update(fields)
                return r
        raise MockAirtableError(404, f"Record {record_id} not found")

    def batch_create(self, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [self.create(r.get("fields", r)) for r in records]

    def batch_update(self, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        results = []
        for r in records:
            results.append(self.update(r["id"], r.get("fields", {})))
        return results

    def clear(self):
        self.records.clear()
        self.rate_limit_hits_remaining = 0
        self.permanent_error_field = None


class MockAirtableBase:
    def __init__(self, base_id: str):
        self.base_id = base_id
        self.tables: Dict[str, MockAirtableTable] = {}

    def table(self, table_name: str) -> MockAirtableTable:
        if table_name not in self.tables:
            self.tables[table_name] = MockAirtableTable(table_name)
        return self.tables[table_name]


class MockAirtableApi:
    def __init__(self, api_key: str = "mock-key"):
        self.api_key = api_key
        self.bases: Dict[str, MockAirtableBase] = {}

    def base(self, base_id: str) -> MockAirtableBase:
        if base_id not in self.bases:
            self.bases[base_id] = MockAirtableBase(base_id)
        return self.bases[base_id]

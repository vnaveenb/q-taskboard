# Architecture & Design Notes — TaskBoard

## Activity Feed Failure & Rollback Strategy (Part 3b)

### Decision: Atomic Transaction (Rollback on Activity Write Failure)

When an activity write fails during an audited mutation (e.g. task creation, status transition, assignee change, or comment addition), the entire database operation rolls back using Django's `transaction.atomic()` context manager.

### Reasoning & Architectural Trade-offs:

1. **Audit Trail Integrity Over Partial Execution**:
   TaskBoard operates as an accountability and project tracking platform where the activity log forms a legal and operational audit trail of "who did what, when". Allowing a task status change or assignment to commit when its corresponding audit log fails creates untracked "ghost modifications". In enterprise and team environments, an unrecorded permission, status, or assignee change compromises compliance and diagnostic auditability.

2. **ACID Consistency**:
   A state transition in a task management workflow and its audit record constitute a single business event. If the system cannot record that User A completed or assigned Task X, the system is in an inconsistent state. Rolling back ensures strict atomicity (all-or-nothing).

3. **Fast Failure & Transparent Retry**:
   If an activity write fails (e.g., database constraint violation, disk pressure, or network partition on the DB node), returning an HTTP 500 error allows the client or user to safely retry the entire action without risk of partial state or duplicate operations.

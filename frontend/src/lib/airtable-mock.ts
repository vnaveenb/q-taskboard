/**
 * Test double for the Airtable npm SDK.
 * Simulates Airtable in-memory storage, rate limiting, and errors for unit tests.
 */
export type MockAirtableRecord = {
  id: string;
  fields: Record<string, any>;
  createdTime: string;
};

export class MockAirtableTable {
  public records: MockAirtableRecord[] = [];
  public rateLimitCount = 0;
  public failTaskIds: Set<string> = new Set();

  constructor(public tableName: string) {}

  select() {
    return {
      all: async (): Promise<MockAirtableRecord[]> => {
        return [...this.records];
      },
    };
  }

  async create(fields: Record<string, any>): Promise<MockAirtableRecord> {
    if (this.rateLimitCount > 0) {
      this.rateLimitCount--;
      const err: any = new Error("Rate limit exceeded: 429 Too Many Requests");
      err.statusCode = 429;
      throw err;
    }

    const taskId = fields["Task ID"];
    if (taskId && this.failTaskIds.has(taskId)) {
      const err: any = new Error(`Unprocessable Entity: invalid task ${taskId}`);
      err.statusCode = 422;
      throw err;
    }

    const rec: MockAirtableRecord = {
      id: `rec${Math.random().toString(36).substring(2, 16)}`,
      fields: { ...fields },
      createdTime: new Date().toISOString(),
    };
    this.records.push(rec);
    return rec;
  }

  async update(recordId: string, fields: Record<string, any>): Promise<MockAirtableRecord> {
    if (this.rateLimitCount > 0) {
      this.rateLimitCount--;
      const err: any = new Error("Rate limit exceeded: 429 Too Many Requests");
      err.statusCode = 429;
      throw err;
    }

    const idx = this.records.findIndex((r) => r.id === recordId);
    if (idx === -1) {
      const err: any = new Error(`Record ${recordId} not found`);
      err.statusCode = 404;
      throw err;
    }

    this.records[idx].fields = {
      ...this.records[idx].fields,
      ...fields,
    };
    return this.records[idx];
  }
}

export class MockAirtableBase {
  private tables: Map<string, MockAirtableTable> = new Map();

  constructor(public baseId: string) {}

  table(name: string): MockAirtableTable {
    if (!this.tables.has(name)) {
      this.tables.set(name, new MockAirtableTable(name));
    }
    return this.tables.get(name)!;
  }
}

export class MockAirtable {
  private bases: Map<string, MockAirtableBase> = new Map();

  base(baseId: string) {
    if (!this.bases.has(baseId)) {
      this.bases.set(baseId, new MockAirtableBase(baseId));
    }
    return (tableName: string) => this.bases.get(baseId)!.table(tableName);
  }
}

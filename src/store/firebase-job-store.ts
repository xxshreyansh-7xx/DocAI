import type { Firestore } from "firebase-admin/firestore";
import type { JobRecord, RebuildResult } from "../types/job";
import type { JobStore } from "./interfaces";

export class FirebaseJobStore implements JobStore {
  constructor(private readonly firestore: Firestore) {}

  private collection() {
    return this.firestore.collection("rebuild_jobs");
  }

  async create(record: JobRecord): Promise<void> {
    await this.collection().doc(record.jobId).set(record);
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const snap = await this.collection().doc(jobId).get();
    return snap.exists ? (snap.data() as JobRecord) : null;
  }

  async getByIdempotencyKey(key: string): Promise<JobRecord | null> {
    const query = await this.collection().where("idempotencyKey", "==", key).limit(1).get();
    if (query.empty) {
      return null;
    }
    return query.docs[0].data() as JobRecord;
  }

  async update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord> {
    await this.collection().doc(jobId).set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
    const updated = await this.get(jobId);
    if (!updated) {
      throw new Error("Job not found after update");
    }
    return updated;
  }

  async setResult(jobId: string, result: RebuildResult): Promise<JobRecord> {
    return this.update(jobId, {
      result,
      status: "completed",
      progress: { stage: "done", percent: 100 },
      error: undefined,
    });
  }
}

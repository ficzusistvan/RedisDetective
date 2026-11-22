export class StoredSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoredSnapshotError';
  }
}

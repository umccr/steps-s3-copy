export class IsThawingError extends Error {
  constructor(message: string) {
    super();
    this.name = "IsThawingError";
    this.message = message;
  }
}

export class SourceBucketWrongRegionError extends Error {
  constructor(message: string) {
    super();
    this.name = "SourceBucketWrongRegionError";
    this.message = message;
  }
}

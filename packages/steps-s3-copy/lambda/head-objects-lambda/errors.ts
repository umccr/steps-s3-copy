export class IsThawingError extends Error {
  constructor(message: string) {
    super();
    this.name = "IsThawingError";
    this.message = message;
  }
}

export class SourceBucketFieldInvalid extends Error {
  constructor(message: string) {
    super();
    this.name = "SourceBucketFieldInvalid";
    this.message = message;
  }
}

export class SourceKeyFieldInvalid extends Error {
  constructor(message: string) {
    super();
    this.name = "SourceKeyFieldInvalid";
    this.message = message;
  }
}

export class WildcardExpansionMaximumError extends Error {
  constructor(bucket: string, key: string) {
    super();
    this.name = "WildcardExpansionMaximumError";
    this.message = `Expanding s3://${bucket}/${key} resulted in a number of objects that exceeds our safety limit`;
  }
}

export class WildcardExpansionEmptyError extends Error {
  constructor(bucket: string, key: string) {
    super();
    this.name = "WildcardExpansionEmptyError";
    this.message = `Expanding s3://${bucket}/${key} resulted in no objects`;
  }
}

export class SourceBucketWrongRegionError extends Error {
  constructor(message: string) {
    super();
    this.name = "SourceBucketWrongRegionError";
    this.message = message;
  }
}

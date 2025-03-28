export type HeadResultType = {
  sourceBucket: string;
  sourceKey: string;
  exists: boolean;
  storageClass: string;
  size: number;
  etag: string;
  lastModified: string;
};

export type HeadInputType = {
  sourceBucket: string;
  sourceKey: string;
  sums?: string;
};

import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { BucketDefinition } from "../../src/steps-s3-copy-input";

/**
 * Creates an S3Client the specified bucket based on definitions.
 *
 * If a `bucketDefinition` exists for the bucket, that will be used over any other parameters.
 */
export async function buildS3Client(
  bucketName?: string,
  bucketDefinitions?: Record<string, BucketDefinition>,
  requiredRegion?: string,
  noSignRequest?: boolean,
): Promise<S3Client> {
  if (
    bucketDefinitions !== undefined &&
    bucketName !== undefined &&
    bucketName in bucketDefinitions
  ) {
    const def = bucketDefinitions[bucketName];
    if (def === undefined) {
      throw new Error(`bucket "${bucketName}" is undefined`);
    }

    const config: S3ClientConfig = {};

    if (def.endpointUrl !== undefined) {
      config.endpoint = def.endpointUrl;
    }
    if (def.region !== undefined) {
      config.region = def.region;
    }
    // if s3Compatible is set that takes precedence over the endpointUrl logic.
    const s3Compatible = def.s3Compatible ?? def.endpointUrl !== undefined;
    if (s3Compatible) {
      config.forcePathStyle = true;
    }

    if (def.credentialProvider === "no-credentials") {
      config.signer = { sign: async (request: any) => request };
    } else if (def.credentialProvider === "aws-secret") {
      if (!def.secret) {
        throw new Error(
          `Bucket "${bucketName}" uses credential provider "aws-secret" but no secret is specified`,
        );
      }

      const secretRegion = def.secret.startsWith("arn:")
        ? def.secret.split(":")[3]
        : undefined;
      const secretsManager = new SecretsManagerClient(
        secretRegion ? { region: secretRegion } : {},
      );
      const response = await secretsManager.send(
        new GetSecretValueCommand({ SecretId: def.secret }),
      );

      let value: string;
      if (response.SecretString) {
        value = response.SecretString;
      } else if (response.SecretBinary) {
        value = new TextDecoder().decode(response.SecretBinary);
      } else {
        throw new Error(
          `Secret "${def.secret}" for bucket "${bucketName}" has neither SecretString nor SecretBinary`,
        );
      }

      const parsed = JSON.parse(value);
      config.credentials = {
        accessKeyId: parsed.access_key_id,
        secretAccessKey: parsed.secret_access_key,
        ...(parsed.session_token && { sessionToken: parsed.session_token }),
      };
    }

    return new S3Client(config);
  }

  const config: S3ClientConfig = {};
  if (noSignRequest) {
    config.signer = { sign: async (request: any) => request };
  }
  if (requiredRegion) {
    config.region = requiredRegion;
  }

  return new S3Client(config);
}

/**
 * Returns a cached S3Client builder where the clients are cached per bucket and
 * noSignRequest so repeated calls within one loop don't rebuild clients unnecessarily.
 */
export function createS3ClientCache(
  bucketDefinitions?: Record<string, BucketDefinition>,
) {
  const cache = new Map<string, Promise<S3Client>>();
  return (
    bucket: string,
    noSignRequest?: boolean,
    requiredRegion?: string,
  ): Promise<S3Client> => {
    const key = `${bucket}-${!!noSignRequest}-${requiredRegion ?? ""}`;
    let promise = cache.get(key);
    if (!promise) {
      promise = buildS3Client(
        bucket,
        bucketDefinitions,
        requiredRegion,
        noSignRequest,
      );
      cache.set(key, promise);
    }
    return promise;
  };
}

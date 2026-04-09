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
export async function buildS3ClientForBucket(
  bucketName: string,
  bucketDefinitions: Record<string, BucketDefinition>,
  sourceNoSignRequest?: boolean,
): Promise<S3Client> {
  if (bucketName in bucketDefinitions) {
    const def = bucketDefinitions[bucketName];
    const config: S3ClientConfig = {};

    if (def.endpointUrl !== undefined) {
      config.endpoint = def.endpointUrl;
    }
    if (def.region !== undefined) {
      config.region = def.region;
    }
    if (def.s3Compatible !== undefined) {
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

      const secretsManager = new SecretsManagerClient();
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

  if (sourceNoSignRequest) {
    return new S3Client({
      signer: { sign: async (request: any) => request },
    });
  }

  return new S3Client();
}

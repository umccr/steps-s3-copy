/**
 * A class that encapsulates functionality of splitting a Buffer
 * for the purposes of uploading to AWS S3.
 *
 * The assumption here is that all these objects can fit in memory, as we
 * are not expecting this is used for anything other than test objects
 * (MBs not GBs)
 */
export class BufferSplit {
  public readonly partCount: number;
  public readonly partLast: number;

  /**
   * Calculate the number of parts that would go into the given Buffer with
   * the given part size.
   * If no part size is supplied then the implication for the rest of the system
   * is that this will be transferred as a single blob (no multipart at all, which is
   * technically different to 1 single multipart!).
   * The partLast is the amount to transfer in the final transfer (for the case
   * of a single blob this is also the *only* transfer).
   *
   * @param buffer
   * @param possiblePartSize
   */
  public constructor(
    public readonly buffer: Buffer,
    private readonly possiblePartSize?: number,
  ) {
    if (possiblePartSize === 0)
      throw new Error("You cannot use a part size of zero");

    if (possiblePartSize) {
      this.partCount = Math.ceil(buffer.length / possiblePartSize);
      this.partLast = buffer.length % possiblePartSize;
    } else {
      this.partCount = 1;
      this.partLast = buffer.length;
    }
  }

  public get partSize(): number {
    if (this.isSinglePart)
      throw new Error("These is no part size if this is a single part");

    return this.possiblePartSize!;
  }

  public get isSinglePart(): boolean {
    return !this.possiblePartSize;
  }
}

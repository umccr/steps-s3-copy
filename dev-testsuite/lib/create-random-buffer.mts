/**
 * Create a buffer of a set size initialised with random content controlled
 * by the given seed. For the same invocation with the same seed this will always
 * return the same content.
 *
 * @param sizeInBytes
 * @param contentSeed
 */
export function createRandomBuffer(sizeInBytes: number, contentSeed: number) {
  // from the internet
  // https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
  // in no way is this cryptographic - or even good randomness -
  // but it will consistently get the same sequence of bytes from a fixed seed which
  // is what we want
  function sfc32(a: number, b: number, c: number, d: number) {
    return function () {
      a |= 0;
      b |= 0;
      c |= 0;
      d |= 0;
      let t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return t >>> 0;
    };
  }

  // seed the randomness (the +1, +2, +3 are totally arbitrary)
  const getRand = sfc32(
    contentSeed,
    contentSeed + 1,
    contentSeed + 2,
    contentSeed + 3,
  );

  // prime the random generator with some iterations
  getRand();
  getRand();
  getRand();
  getRand();

  const buffer = Buffer.alloc(sizeInBytes);

  // fill in the buffer with random content
  for (let pos = 0; pos < sizeInBytes; pos += 4) {
    const nextRand = getRand();

    // we might need to handle the trailing 1, 2 or 3 bytes at the end of the buffer
    if (pos + 1 >= sizeInBytes) {
      // just lowest 8 bits
      buffer.writeUInt8(nextRand & 0xff, pos);
    } else if (pos + 2 >= sizeInBytes) {
      // lower 16 bits
      buffer.writeUint16LE(nextRand & 0xffff, pos);
    } else if (pos + 3 >= sizeInBytes) {
      // need to write the 24 bits as two operations
      buffer.writeUInt8(nextRand & 0xff, pos);
      buffer.writeUint16LE((nextRand & 0xffff00) >> 8, pos + 1);
    } else {
      // otherwise we are just generally writing 4 bytes
      // write entire 32 bits
      buffer.writeUint32LE(nextRand, pos);
    }
  }

  return buffer;
}

//A little mini test-suite
/*(async () => {
  const zero = createRandomBuffer(0, 0);
  const one = createRandomBuffer(1, 0);
  const two = createRandomBuffer(2, 0);
  const three = createRandomBuffer(3, 0);
  const four = createRandomBuffer(4, 0);
  const five = createRandomBuffer(5, 0);
  const large = createRandomBuffer(16956, 0);

  console.assert(zero.length === 0);
  console.assert(one.length === 1);
  console.assert(
    one[0] === 0x0e,
    "Random buffer generation has changed content",
  );
  console.assert(two.length === 2);
  console.assert(
    two[0] === 0x0e,
    "Random buffer generation for two byte buffer has changed content",
  );
  console.assert(
    two[1] === 0x9b,
    "Random buffer generation for two byte buffer has changed content",
  );
  console.assert(three.length === 3);
  console.assert(
    three[0] === 0x0e,
    "Random buffer generation for three byte buffer has changed content",
  );
  console.assert(
    three[1] === 0x9b,
    "Random buffer generation for three byte buffer has changed content",
  );
  console.assert(
    three[2] === 0xa2,
    "Random buffer generation for three byte buffer has changed content",
  );
  console.assert(four.length === 4);
  console.assert(
    four[0] === 0x0e,
    "Random buffer generation for four byte buffer has changed content",
  );
  console.assert(
    four[1] === 0x9b,
    "Random buffer generation for four byte buffer has changed content",
  );
  console.assert(
    four[2] === 0xa2,
    "Random buffer generation for four byte buffer has changed content",
  );
  console.assert(
    four[3] === 0x32,
    "Random buffer generation for four byte buffer has changed content",
  );
  console.assert(five.length === 5);
  console.assert(
    five[0] === 0x0e,
    "Random buffer generation for five byte buffer has changed content",
  );
  console.assert(
    five[1] === 0x9b,
    "Random buffer generation for five byte buffer has changed content",
  );
  console.assert(
    five[2] === 0xa2,
    "Random buffer generation for five byte buffer has changed content",
  );
  console.assert(
    five[3] === 0x32,
    "Random buffer generation for five byte buffer has changed content",
  );
  console.assert(
    five[4] === 0x30,
    "Random buffer generation for five byte buffer has changed content",
  );
})();
*/

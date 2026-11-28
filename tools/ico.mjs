// A `.ico` file from PNG pictures: the container browsers and Google read at `/favicon.ico` (#69).
// Each picture is stored as the PNG it is, which every browser since Internet Explorer 9 reads.
const HEADER_BYTES = 6,
  ENTRY_BYTES = 16;
const ICON_TYPE = 1; // 1 is an icon, 2 a cursor
const PNG_WIDTH_OFFSET = 16; // IHDR: width then height, big-endian, after the 8-byte signature and the chunk header
const LARGEST = 256; // a side of 256 px is written as 0
const COLOUR_PLANES = 1,
  BITS_PER_PIXEL = 32;
// Where each field sits: in the file's header, and in a picture's entry of the directory after it.
const AT = { type: 2, count: 4 };
const IN_ENTRY = { width: 0, height: 1, palette: 2, reserved: 3, planes: 4, bits: 6, bytes: 8, offset: 12 };
const PNG_HEIGHT_OFFSET = PNG_WIDTH_OFFSET + 4; // a width is four bytes

/** The bytes of an icon file holding `pngs` (Buffers of square PNG pictures, at most 256 px a side), in their order. */
export function icoOf(pngs) {
  const header = Buffer.alloc(HEADER_BYTES + ENTRY_BYTES * pngs.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(ICON_TYPE, AT.type);
  header.writeUInt16LE(pngs.length, AT.count);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const width = png.readUInt32BE(PNG_WIDTH_OFFSET),
      height = png.readUInt32BE(PNG_HEIGHT_OFFSET);
    if (width !== height || width > LARGEST) throw new Error(`an icon picture is square and at most ${LARGEST} px: got ${width} by ${height}`);
    const entry = HEADER_BYTES + ENTRY_BYTES * i;
    header.writeUInt8(width % LARGEST, entry + IN_ENTRY.width);
    header.writeUInt8(height % LARGEST, entry + IN_ENTRY.height);
    header.writeUInt8(0, entry + IN_ENTRY.palette); // no palette
    header.writeUInt8(0, entry + IN_ENTRY.reserved);
    header.writeUInt16LE(COLOUR_PLANES, entry + IN_ENTRY.planes);
    header.writeUInt16LE(BITS_PER_PIXEL, entry + IN_ENTRY.bits);
    header.writeUInt32LE(png.length, entry + IN_ENTRY.bytes);
    header.writeUInt32LE(offset, entry + IN_ENTRY.offset);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}

/** The pictures of an icon file as [{ width, height, png }], read back from its bytes. */
export function icoPictures(ico) {
  const count = ico.readUInt16LE(AT.count);
  return [...Array(count).keys()].map(i => {
    const entry = HEADER_BYTES + ENTRY_BYTES * i,
      size = ico.readUInt32LE(entry + IN_ENTRY.bytes),
      offset = ico.readUInt32LE(entry + IN_ENTRY.offset);
    return {
      width: ico.readUInt8(entry + IN_ENTRY.width) || LARGEST,
      height: ico.readUInt8(entry + IN_ENTRY.height) || LARGEST,
      png: ico.subarray(offset, offset + size),
    };
  });
}

// LZSS encoder/decoder
// Ported by mav from Python source by Niema Moshiri
// https://github.com/niemasd/PyFF7

const MIN_REF_LEN = 3;
const MAX_REF_LEN = 18;
const LEFT_NIBBLE_MASK = 0b11110000;
const RIGHT_NIBBLE_MASK = 0b00001111;
const WINDOW_MASK = 0x0FFF;
const WINDOW_SIZE = 0x1000;
const REF_SIZE = 2;

type DictionaryEntry = { [key: string]: number };
type ReverseEntry = { [key: number]: string };

// Helper function to convert Uint8Array to hex string
function toHex(arr: Uint8Array): string {
    return Array.from(arr)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

class Dictionary {
    private ptr: number;
    private d: DictionaryEntry[];
    private r: ReverseEntry[];

    constructor(ptr: number) {
        this.ptr = ptr;
        // Seed dictionary arrays with empty objects
        this.d = new Array(MAX_REF_LEN + 1).fill(null).map(() => ({}));
        this.r = new Array(MAX_REF_LEN + 1).fill(null).map(() => ({}));
    }

    add(bytes: Uint8Array | string, hex: boolean = false): void {
        // Because original source worked on string-like byte arrays we're using hex arrays here
        // This means string lengths are multiplied by 2
        const s = hex ? bytes as string : toHex(bytes as Uint8Array);
        for (let length = MIN_REF_LEN; length < Math.min(s.length / 2, MAX_REF_LEN); length++) {
            const substr = s.substr(0, length * 2);

            if (this.d[length][substr] in this.r[length]) {
                delete this.r[length][this.d[length][substr]];
            }

            if (this.r[length][this.ptr] in this.d[length]) {
                delete this.d[length][this.r[length][this.ptr]];
            }

            this.d[length][substr] = this.ptr;
            this.r[length][this.ptr] = substr;
        }

        this.ptr = (this.ptr + 1) & WINDOW_MASK;
    }

    find(bytes: Uint8Array): [number, number] | null {
        // See the note above about working with hex strings
        const s = toHex(bytes);
        for (let length = Math.min(MAX_REF_LEN, s.length / 2); length > MIN_REF_LEN - 1; length--) {
            const substr = s.substr(0, length * 2);
            if (substr in this.d[length]) {
                const offset = this.d[length][substr];
                if (offset !== this.ptr) {
                    return [offset, length];
                }
            }
        }

        return null;
    }
}

export class Lzss {
    // Converts a raw offset to real offset
    private correctOffset(rawOffset: number, tail: number): number {
        return tail - ((tail - MAX_REF_LEN - rawOffset) & WINDOW_MASK);
    }

    decompress(data: Uint8Array): Uint8Array {
        let inpos = 0;
        // Pre-allocate a large buffer and track position
        // Estimate output size (typically 2-4x input for LZSS)
        let capacity = data.length * 4;
        let out = new Uint8Array(capacity);
        let outpos = 0;

        while (inpos < data.length) {
            const control = data[inpos++];

            // Process 8 flags from control byte (unrolled for performance)
            for (let bit = 0; bit < 8; bit++) {
                if (inpos >= data.length) break;

                const isLiteral = (control & (1 << bit)) !== 0;

                if (isLiteral) {
                    // Ensure capacity inline to avoid function call overhead
                    if (outpos >= capacity) {
                        capacity *= 2;
                        const newOut = new Uint8Array(capacity);
                        newOut.set(out);
                        out = newOut;
                    }
                    out[outpos++] = data[inpos++];
                } else {
                    // Read reference directly
                    const ref0 = data[inpos];
                    const ref1 = data[inpos + 1];
                    inpos += REF_SIZE;

                    const offset = ((ref1 & LEFT_NIBBLE_MASK) << 4) | ref0;
                    const length = (ref1 & RIGHT_NIBBLE_MASK) + MIN_REF_LEN;

                    let pos = this.correctOffset(offset, outpos);

                    // Ensure capacity for the entire copy
                    if (outpos + length > capacity) {
                        capacity = Math.max(capacity * 2, outpos + length);
                        const newOut = new Uint8Array(capacity);
                        newOut.set(out);
                        out = newOut;
                    }

                    // Handle negative position (pre-buffer zeros)
                    if (pos < 0) {
                        const zerosToAdd = Math.min(-pos, length);
                        for (let i = 0; i < zerosToAdd; i++) {
                            out[outpos++] = 0;
                        }
                        pos += zerosToAdd;
                        // Copy remaining from back-reference
                        const remaining = length - zerosToAdd;
                        for (let i = 0; i < remaining; i++) {
                            out[outpos++] = out[pos + i];
                        }
                    } else {
                        // Copy from back-reference, byte by byte
                        // This handles overlapping copies correctly (RLE-style)
                        for (let i = 0; i < length; i++) {
                            out[outpos++] = out[pos + i];
                        }
                    }
                }
            }
        }

        // Return only the used portion using subarray to avoid copy
        // Then slice to create an independent buffer (required since out may be reused)
        return out.subarray(0, outpos).slice();
    }

    compress(data: Uint8Array): Uint8Array {
        const dictionary = new Dictionary(WINDOW_SIZE - 2 * MAX_REF_LEN);

        // Prime the dictionary
        for (let i = 0; i < MAX_REF_LEN; i++) {
            const primeData = new Uint8Array(MAX_REF_LEN - i);
            dictionary.add(new Uint8Array([...primeData, ...data.slice(0, i)]));
        }

        let out: number[] = [];
        let i = 0;
        while (i < data.length) {
            let chunk: number[] = [];
            let flags = 0;
            for (let bit = 0; bit < 8; bit++) {
                if (i >= data.length)
                    break;

                const found = dictionary.find(data.slice(i, i + MAX_REF_LEN));
                if (found) {
                    const [offset, length] = found;
                    chunk = chunk.concat([offset & 0xFF, (((offset >> 4) & 0xF0) | (length - MIN_REF_LEN))]);
                    for (let j = 0; j < length; j++) {
                        dictionary.add(data.slice(i + j, i + j + MAX_REF_LEN));
                    }
                    i += length;
                } else {
                    chunk.push(data[i]);
                    flags |= (1 << bit);
                    dictionary.add(data.slice(i, i + MAX_REF_LEN));
                    i += 1;
                }
            }
            out.push(flags);
            out = out.concat(chunk);
        }

        return Uint8Array.from(out);
    }
}

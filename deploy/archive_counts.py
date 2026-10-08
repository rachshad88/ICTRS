#!/usr/bin/env python3
"""Count documents per collection in a gzipped mongodump archive, without a database.

    python3 deploy/archive_counts.py <file.archive.gz>      # prints {"users": 9, ...} as JSON

Used by backup.sh (to log counts and spot sudden drops) and restore.sh (to show what a backup holds).
Archive layout: magic number, header and metadata BSON documents up to a -1 terminator, then one block
per collection: a namespace header document, the collection's documents, and a -1 terminator.
Exits 1 if the file is not a readable archive.
"""
import gzip
import json
import re
import struct
import sys

MAGIC = 0x8199E26D
TERMINATOR = -1
COLLECTION = re.compile(rb'\x02collection\x00[\x00-\xff]{4}([^\x00]+)\x00')
EOF_TRUE = b'\x08EOF\x00\x01'


def count(path):
    data = gzip.open(path).read()
    if len(data) < 4 or struct.unpack_from('<I', data, 0)[0] != MAGIC:
        raise ValueError('not a mongodump archive')
    pos = 4

    def next_doc():
        nonlocal pos
        (size,) = struct.unpack_from('<i', data, pos)
        if size == TERMINATOR:
            pos += 4
            return None
        if size < 5 or pos + size > len(data):
            raise ValueError(f'bad document length at byte {pos}')
        doc = data[pos:pos + size]
        pos += size
        return doc

    while next_doc() is not None:  # header and collection metadata
        pass

    counts = {}
    current = None
    while pos < len(data):
        doc = next_doc()
        if doc is None:
            current = None
            continue
        if current is None:
            # A namespace header opens each block; EOF:true marks a collection as finished.
            match = COLLECTION.search(doc)
            if not match:
                raise ValueError(f'expected a namespace header at byte {pos}')
            name = match.group(1).decode()
            counts.setdefault(name, 0)
            current = None if EOF_TRUE in doc else name
            continue
        counts[current] += 1
    return dict(sorted(counts.items()))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: archive_counts.py <file.archive.gz>')
    try:
        print(json.dumps(count(sys.argv[1])))
    except (OSError, ValueError, struct.error) as err:
        print(f'archive_counts: {err}', file=sys.stderr)
        sys.exit(1)

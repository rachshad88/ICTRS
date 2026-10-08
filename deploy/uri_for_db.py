#!/usr/bin/env python3
"""Print a mongodump/mongorestore --config line whose URI targets another database on the same server.

    python3 deploy/uri_for_db.py "<MONGO_URI>" itrs_rating   # -> uri: "mongodb://.../itrs_rating?authSource=itrs"

The MongoDB tools refuse a --db that differs from the database in the URI. The login still has to happen where
the user is defined, so the URI's original database (or its existing authSource) becomes authSource.
"""
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

uri, target_db = sys.argv[1], sys.argv[2]
parts = urlsplit(uri)
query = dict(parse_qsl(parts.query))
original_db = parts.path.lstrip('/') or 'admin'
query.setdefault('authSource', original_db)
rewritten = urlunsplit((parts.scheme, parts.netloc, '/' + target_db, urlencode(query), parts.fragment))
print(f'uri: "{rewritten}"')

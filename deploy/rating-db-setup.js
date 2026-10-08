// One-time setup of the shared rating database "itrs_rating" (see deploy/RATING_DB.md).
// Run as a MongoDB account that can manage users and roles (the one that created itrs_app):
//
//   mongo admin -u <admin user> -p --authenticationDatabase admin deploy/rating-db-setup.js
//
// It asks for a new password for the rating system's account. Safe to run again: it only adds what is
// missing, and running it again resets the rating_app password to the one you type.
//
// Afterwards:
//   itrs_app   (ITRS backend)    readWrite on itrs_rating: keeps request_status current, backs up the database.
//   rating_app (rating system)   read request_status; read and write ratings. Cannot change statuses.

var RATING_DB = 'itrs_rating';
var ratingDb = db.getSiblingDB(RATING_DB);

// 1. Let the ITRS backend write request statuses. itrs_app is defined in the itrs database.
var itrs = db.getSiblingDB('itrs');
var app = itrs.getUser('itrs_app');
if (!app) {
  print('ERROR: user itrs_app not found in the itrs database. Is this the right server?');
  quit(1);
}
var hasRating = app.roles.some(function (r) { return r.db === RATING_DB && r.role === 'readWrite'; });
if (hasRating) {
  print('itrs_app already has readWrite on ' + RATING_DB);
} else {
  itrs.grantRolesToUser('itrs_app', [{ role: 'readWrite', db: RATING_DB }]);
  print('Granted itrs_app readWrite on ' + RATING_DB);
}

// 2. A role for the rating system: read statuses, own the ratings collection.
var privileges = [
  { resource: { db: RATING_DB, collection: 'request_status' }, actions: ['find'] },
  {
    resource: { db: RATING_DB, collection: 'ratings' },
    actions: ['find', 'insert', 'update', 'remove', 'createCollection', 'createIndex', 'listIndexes'],
  },
  { resource: { db: RATING_DB, collection: '' }, actions: ['listCollections'] },
];
if (ratingDb.getRole('ratingSystem')) {
  ratingDb.updateRole('ratingSystem', { privileges: privileges, roles: [] });
  print('Updated role ratingSystem');
} else {
  ratingDb.createRole({ role: 'ratingSystem', privileges: privileges, roles: [] });
  print('Created role ratingSystem');
}

// 3. The rating system's own login, defined in itrs_rating (so its authSource is itrs_rating).
print('Choose a password for rating_app (the rating system\'s database login):');
var pwd = passwordPrompt();
if (!pwd || pwd.length < 12) {
  print('ERROR: use a password of at least 12 characters. Nothing else was changed for rating_app.');
  quit(1);
}
if (ratingDb.getUser('rating_app')) {
  ratingDb.updateUser('rating_app', { pwd: pwd, roles: [{ role: 'ratingSystem', db: RATING_DB }] });
  print('Updated user rating_app');
} else {
  ratingDb.createUser({ user: 'rating_app', pwd: pwd, roles: [{ role: 'ratingSystem', db: RATING_DB }] });
  print('Created user rating_app');
}

print('');
print('Done. Restart the ITRS backend (sudo pm2 restart backend); it fills request_status within a minute.');
print('Give the rating system this connection string (URL-encode the password if it has symbols):');
print('mongodb://rating_app:<password>@192.168.110.28:27017/' + RATING_DB + '?authSource=' + RATING_DB);

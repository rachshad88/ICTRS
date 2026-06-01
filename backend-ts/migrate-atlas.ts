import 'dotenv/config';
import { MongoClient } from 'mongodb';

const ATLAS_URI = 'mongodb+srv://dslannu_db_user:LPz4CgfPFaO04kFE@cluster0.x8kizuw.mongodb.net/?authMechanism=SCRAM-SHA-1';
const LOCAL_URI = 'mongodb://127.0.0.1:27017';
const DB_NAME = 'itrs';

async function migrateData() {
  console.log('Starting data migration from Atlas to Local MongoDB...\n');

  let atlasClient: MongoClient | null = null;
  let localClient: MongoClient | null = null;

  try {
    // Connect to Atlas
    console.log('Connecting to MongoDB Atlas...');
    atlasClient = new MongoClient(ATLAS_URI, {
      connectTimeoutMS: 30000,
      serverSelectionTimeoutMS: 30000,
    });
    await atlasClient.connect();
    console.log('✅ Connected to Atlas\n');

    // Connect to Local
    console.log('Connecting to Local MongoDB...');
    localClient = new MongoClient(LOCAL_URI);
    await localClient.connect();
    console.log('✅ Connected to Local MongoDB\n');

    const atlasDb = atlasClient.db(DB_NAME);
    const localDb = localClient.db(DB_NAME);

    // Get all collections
    const collections = await atlasDb.listCollections().toArray();
    console.log(`Found ${collections.length} collections in Atlas:\n`);

    // Migrate each collection
    for (const col of collections) {
      const collectionName = col.name;
      console.log(`📋 Migrating collection: ${collectionName}`);

      const sourceCollection = atlasDb.collection(collectionName);
      const targetCollection = localDb.collection(collectionName);

      // Get count
      const count = await sourceCollection.countDocuments();
      console.log(`   Documents to migrate: ${count}`);

      if (count > 0) {
        // Get all documents
        const documents = await sourceCollection.find({}).toArray();

        // Clear existing data in local
        await targetCollection.deleteMany({});

        // Insert all documents
        await targetCollection.insertMany(documents);
        console.log(`   ✅ Migrated ${count} documents\n`);
      } else {
        console.log(`   ℹ️  No documents to migrate\n`);
      }
    }

    console.log('═══════════════════════════════════════');
    console.log('✅ MIGRATION COMPLETE!');
    console.log('═══════════════════════════════════════\n');

    // Show users in local
    const usersCollection = localDb.collection('users');
    const users = await usersCollection.find({}).toArray();
    console.log('📝 Users now in Local MongoDB:');
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.username} (${user.role})`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    if (atlasClient) await atlasClient.close();
    if (localClient) await localClient.close();
  }
}

migrateData().catch(console.error);

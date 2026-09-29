import { openDatabase } from '../services/database';
import { ensureStorageDirectories } from '../services/storage';
import { env } from '../config/env';

ensureStorageDirectories();
const db = openDatabase();
db.close();
console.log(`SQLite database initialized at ${env.databasePath}`);

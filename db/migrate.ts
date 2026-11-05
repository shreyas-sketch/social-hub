/** Creates or updates the database tables. Safe to run any time: npm run migrate */
import { db, dbFile } from "./index";

db();
console.log(`Database ready: ${dbFile()}`);

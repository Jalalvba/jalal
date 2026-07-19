import { MongoClient, type Collection, type Document } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Missing MONGODB_URI in .env.local");

const dbName = process.env.MONGODB_DB;
if (!dbName) throw new Error("Missing MONGODB_DB in .env.local");

declare global {
  // Needed to prevent multiple connections in dev (Next hot reload)
  var _mongo: Promise<MongoClient> | undefined;
}

const client = new MongoClient(uri);

const clientPromise =
  global._mongo ?? (global._mongo = client.connect());

export default clientPromise;

export async function getCollection<T extends Document = Document>(
  name: string
): Promise<Collection<T>> {
  const connected = await clientPromise;
  return connected.db(dbName).collection<T>(name);
}

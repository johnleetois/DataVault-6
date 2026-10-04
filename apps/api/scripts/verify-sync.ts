import "../src/config/load-env.js";
import { AdminManagementService } from "../src/services/admin-management.service.js";
import { firebaseUserService } from "../src/firebase/firebase-user.service.js";

async function run() {
  console.log("Firebase isConfigured:", firebaseUserService.isConfigured);
  const service = new AdminManagementService();
  const res = await service.syncAllToFirebase();
  console.log("syncAllToFirebase result:", res);
}

run().catch(console.error);

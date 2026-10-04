import { getFirebaseConfig, type FirebaseConfig } from "./config.js";

export type FirebaseUserDocument = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  emailVerified: boolean;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
  firebaseUid?: string | undefined;
};

export class FirebaseUserService {
  private readonly explicitConfig: FirebaseConfig | undefined;

  constructor(config?: FirebaseConfig | undefined) {
    this.explicitConfig = config;
  }

  get config(): FirebaseConfig {
    return this.explicitConfig ?? getFirebaseConfig();
  }

  get isConfigured(): boolean {
    return this.config.configured;
  }

  /**
   * Synchronize an admin/user profile into the Cloud Firestore `users` collection.
   * Uses Cloud Firestore REST API v1.
   */
  async syncUserToFirestore(user: FirebaseUserDocument): Promise<boolean> {
    if (process.env.NODE_ENV === "test" || !this.config.configured || !this.config.projectId || !this.config.apiKey) {
      return false;
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents/users/${encodeURIComponent(user.id)}?key=${encodeURIComponent(this.config.apiKey)}`;
      const payload = {
        fields: {
          id: { stringValue: user.id },
          name: { stringValue: user.name },
          email: { stringValue: user.email.toLowerCase() },
          role: { stringValue: user.role || "ADMIN" },
          status: { stringValue: user.status || "PENDING" },
          emailVerified: { booleanValue: Boolean(user.emailVerified) },
          ...(user.firebaseUid ? { firebaseUid: { stringValue: user.firebaseUid } } : {}),
          updatedAt: { timestampValue: new Date().toISOString() }
        }
      };

      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        console.warn(`[Firebase Firestore Warning] Failed to sync user ${user.email} (${res.status}): ${errorText}`);
        return false;
      }

      console.info(`[Firebase Firestore] User document synchronized: ${user.email} -> users/${user.id}`);
      return true;
    } catch (err) {
      console.warn(`[Firebase Firestore Error] Failed to connect to Firestore:`, err);
      return false;
    }
  }

  /**
   * Delete a user profile from Cloud Firestore `users` collection.
   */
  async deleteUserFromFirestore(userId: string): Promise<boolean> {
    if (process.env.NODE_ENV === "test" || !this.config.configured || !this.config.projectId || !this.config.apiKey) {
      return false;
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents/users/${encodeURIComponent(userId)}?key=${encodeURIComponent(this.config.apiKey)}`;
      const res = await fetch(url, { method: "DELETE" });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch all user documents from Cloud Firestore `users` collection.
   */
  async listUsersFromFirestore(): Promise<FirebaseUserDocument[]> {
    if (process.env.NODE_ENV === "test" || !this.config.configured || !this.config.projectId || !this.config.apiKey) {
      return [];
    }

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/databases/(default)/documents/users?key=${encodeURIComponent(this.config.apiKey)}`;
      const res = await fetch(url);
      if (!res.ok) return [];

      const data = (await res.json()) as { documents?: Array<{ fields?: Record<string, { stringValue?: string; booleanValue?: boolean }> }> };
      if (!data.documents) return [];

      return data.documents.map((doc) => {
        const f = doc.fields || {};
        return {
          id: f.id?.stringValue || "",
          name: f.name?.stringValue || "",
          email: f.email?.stringValue || "",
          role: f.role?.stringValue || "ADMIN",
          status: f.status?.stringValue || "PENDING",
          emailVerified: Boolean(f.emailVerified?.booleanValue),
          firebaseUid: f.firebaseUid?.stringValue
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Ensures the user account exists in Firebase Authentication so password reset emails can be sent.
   */
  async ensureFirebaseAuthUser(email: string): Promise<boolean> {
    if (process.env.NODE_ENV === "test" || !this.config.configured || !this.config.apiKey) {
      return false;
    }

    try {
      const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(this.config.apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password: "Nexus@" + Math.random().toString(36).slice(2, 10) + "!",
          returnSecureToken: true
        })
      });
      return res.ok || res.status === 400; // 400 with EMAIL_EXISTS is expected if user already exists
    } catch {
      return false;
    }
  }

  /**
   * Dispatches a Password Reset / Configuration Link via Firebase Auth REST API.
   * Sends directly from `@firebaseapp.com` with no custom domain required.
   */
  async sendFirebasePasswordResetEmail(email: string): Promise<{ success: boolean; link?: string | undefined }> {
    if (process.env.NODE_ENV === "test" || !this.config.configured || !this.config.apiKey) {
      return { success: false };
    }

    try {
      await this.ensureFirebaseAuthUser(email);

      const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(this.config.apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "PASSWORD_RESET",
          email: email.trim().toLowerCase()
        })
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        console.warn(`[Firebase Auth Warning] sendOobCode failed for ${email} (${res.status}): ${errorText}`);
        return { success: false };
      }

      const data = (await res.json()) as { oobLink?: string };
      console.info(`[Firebase Auth] Password setup email dispatched by Firebase for ${email}`);
      return { success: true, link: data.oobLink };
    } catch (err) {
      console.warn(`[Firebase Auth Error] Failed to request Firebase password reset:`, err);
      return { success: false };
    }
  }

  /**
   * Verify an email and password against Firebase Authentication.
   */
  async verifyFirebasePassword(email: string, password: string): Promise<{ success: boolean; idToken?: string | undefined; localId?: string | undefined }> {
    if (process.env.NODE_ENV === "test" || !this.config.configured || !this.config.apiKey) {
      return { success: false };
    }

    try {
      const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(this.config.apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          returnSecureToken: true
        })
      });

      if (!res.ok) {
        return { success: false };
      }

      const data = (await res.json()) as { idToken?: string; localId?: string };
      return { success: true, idToken: data.idToken, localId: data.localId };
    } catch {
      return { success: false };
    }
  }
}

export const firebaseUserService = new FirebaseUserService();

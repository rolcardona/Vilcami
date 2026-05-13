import ky from "ky";
import { API_BASE_URL } from "@/lib/constants";
import { supabase } from "@/auth/supabase";

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

export const api = ky.create({
  prefixUrl: API_BASE_URL,
  hooks: {
    beforeRequest: [
      async (request) => {
        const headers = await getAuthHeader();
        if (headers.Authorization) {
          request.headers.set("Authorization", headers.Authorization);
        }
      },
    ],
  },
  retry: { limit: 2, methods: ["get"] },
});
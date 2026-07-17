// THIN LLM CLIENT OVER OPENROUTER (PLAN §6 TWO-LAYER AI). EVERY CALL ASKS FOR
// STRICT JSON AND PARSES DEFENSIVELY — CODEFENCES AND PREAMBLE ARE TOLERATED,
// ANYTHING ELSE RETURNS null AND THE UI FALLS BACK GRACEFULLY.
//
// KEY SETUP (.env, GITIGNORED):
//   EXPO_PUBLIC_OPENROUTER_KEY=sk-or-...
//   EXPO_PUBLIC_OPENROUTER_MODEL=anthropic/claude-sonnet-4.5   (OPTIONAL)
// EXPO_PUBLIC_* VARS COMPILE INTO THE JS BUNDLE — FINE FOR A PERSONAL DEV
// BUILD; A SHIPPED APP MOVES THIS BEHIND A BACKEND PROXY (PLAN §7).

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const api_key = process.env.EXPO_PUBLIC_OPENROUTER_KEY;
const model = process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5';

// TRUE WHEN AN OPENROUTER KEY IS CONFIGURED — GATES EVERY AI SURFACE SO THE
// APP STAYS FULLY MANUAL WITHOUT ONE.
export const llm_is_live = api_key != null && api_key.length > 10;

// PULL THE FIRST JSON OBJECT OUT OF A COMPLETION.
function extract_json<T>(text: string | undefined | null): T | null {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export async function llm_json<T>(
  system: string,
  user: string,
  opts?: { timeout_ms?: number },
): Promise<T | null> {
  if (!llm_is_live) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeout_ms ?? 30000);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.5,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return extract_json<T>(data.choices?.[0]?.message?.content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

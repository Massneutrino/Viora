import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:6200";
const WORKER_ID = "demo-worker";

interface ShiftOffer {
  id: string;
  roleType: string;
  siteName: string;
  payRate: number;
  rateMode?: "standard" | "dynamic";
  rateExplanation?: string;
  travelMinutes?: number;
  fitExplanation: string;
}

function mapOfferFromApi(raw: Record<string, unknown>): ShiftOffer {
  const bookingRequest = raw.bookingRequest as {
    roleType?: string;
    site?: { name?: string };
  } | undefined;
  const fitExplanation = String(raw.fitExplanation ?? "This shift matches your profile.");
  const kmMatch = fitExplanation.match(/(\d+(?:\.\d+)?)\s*km/i);
  const travelMinutes = kmMatch ? Math.round(parseFloat(kmMatch[1]) / 0.5) : undefined;

  return {
    id: String(raw.id),
    roleType: String(raw.role ?? bookingRequest?.roleType ?? "Shift"),
    siteName: String(raw.site ?? bookingRequest?.site?.name ?? "Site TBC"),
    payRate: Number(raw.payPerDay ?? raw.payRate ?? 0),
    rateMode: raw.rateMode === "dynamic" ? "dynamic" : "standard",
    rateExplanation: typeof raw.rateExplanation === "string" ? raw.rateExplanation : undefined,
    travelMinutes: typeof raw.travelMinutes === "number" ? raw.travelMinutes : travelMinutes,
    fitExplanation: String(raw.fitReason ?? fitExplanation),
  };
}

export default function SwipeDeckScreen() {
  const [offer, setOffer] = useState<ShiftOffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadOffer() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/v1/workers/${WORKER_ID}/offer`);
      const data = await res.json();
      if (data.offer ?? data.data) {
        setOffer(mapOfferFromApi(data.offer ?? data.data));
      } else {
        setOffer(null);
        setMessage(data.message ?? data.explanation ?? "No pending offers right now.");
      }
    } catch {
      setOffer(null);
      setMessage("Could not reach API — start the server and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSwipe(direction: "accept" | "decline") {
    if (!offer || acting) return;

    setActing(true);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_URL}/v1/workers/${WORKER_ID}/offers/${offer.id}/${direction}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error ?? data.explanation ?? `Could not ${direction} offer.`);
        return;
      }

      setMessage(
        direction === "accept"
          ? (data.message ?? "Shift accepted ✓")
          : (data.message ?? "Passed"),
      );
      setOffer(null);
    } catch {
      setMessage(`Network error — could not ${direction} offer.`);
    } finally {
      setActing(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>Viora</Text>
        <Text style={styles.subtitle}>Your next best shift</Text>
      </View>

      <View style={styles.deck}>
        {loading ? (
          <ActivityIndicator size="large" color="#818cf8" />
        ) : offer ? (
          <View style={styles.card}>
            <Text style={styles.role}>{offer.roleType}</Text>
            <Text style={styles.site}>{offer.siteName}</Text>
            {offer.rateMode === "dynamic" && (
              <Text style={styles.dynamic}>Dynamic Rate</Text>
            )}
            <Text style={styles.pay}>£{offer.payRate}/day</Text>
            {offer.travelMinutes != null && (
              <Text style={styles.meta}>{offer.travelMinutes} min travel</Text>
            )}
            <Text style={styles.fit}>{offer.fitExplanation}</Text>
            {offer.rateMode === "dynamic" && offer.rateExplanation && (
              <Text style={styles.dynamicExplanation}>{offer.rateExplanation}</Text>
            )}
            <View style={styles.actions}>
              <Pressable
                style={[styles.btn, styles.decline, acting && styles.btnDisabled]}
                onPress={() => handleSwipe("decline")}
                disabled={acting}
              >
                <Text style={styles.btnText}>{acting ? "…" : "Pass"}</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.accept, acting && styles.btnDisabled]}
                onPress={() => handleSwipe("accept")}
                disabled={acting}
              >
                <Text style={styles.btnText}>{acting ? "…" : "Accept"}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.loadBtn} onPress={loadOffer}>
            <Text style={styles.loadBtnText}>Load next offer</Text>
          </Pressable>
        )}
      </View>

      {message && (
        <Text style={[styles.message, message.includes("error") || message.includes("Could not") ? styles.messageError : null]}>
          {message}
        </Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f1419" },
  header: { padding: 24, paddingBottom: 8 },
  brand: { color: "#818cf8", fontSize: 14, fontWeight: "600" },
  subtitle: { color: "#f0f4f8", fontSize: 22, fontWeight: "600", marginTop: 4 },
  deck: { flex: 1, justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: "#1a2332",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#2d3a4f",
  },
  role: { color: "#f0f4f8", fontSize: 20, fontWeight: "600" },
  site: { color: "#94a3b8", fontSize: 16, marginTop: 4 },
  pay: { color: "#22c55e", fontSize: 28, fontWeight: "700", marginTop: 16 },
  dynamic: { color: "#22c55e", fontSize: 12, fontWeight: "600", marginTop: 8 },
  meta: { color: "#94a3b8", marginTop: 8 },
  fit: { color: "#cbd5e1", marginTop: 16, lineHeight: 22 },
  dynamicExplanation: { color: "#86efac", marginTop: 12, lineHeight: 20 },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
  btn: { flex: 1, padding: 14, borderRadius: 10, alignItems: "center" },
  btnDisabled: { opacity: 0.6 },
  decline: { backgroundColor: "#374151" },
  accept: { backgroundColor: "#6366f1" },
  btnText: { color: "#fff", fontWeight: "600" },
  loadBtn: {
    backgroundColor: "#6366f1",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  loadBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  message: { color: "#22c55e", textAlign: "center", padding: 16 },
  messageError: { color: "#f87171" },
});

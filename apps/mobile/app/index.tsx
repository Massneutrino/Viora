import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

interface ShiftOffer {
  roleType: string;
  siteName: string;
  payRate: number;
  travelMinutes: number;
  fitExplanation: string;
}

export default function SwipeDeckScreen() {
  const [offer, setOffer] = useState<ShiftOffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadOffer() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/v1/workers/demo-worker/offer`);
      const data = await res.json();
      if (data.data) {
        setOffer(data.data);
      } else {
        setOffer({
          roleType: "Supply Teacher",
          siteName: "Greenfield Primary",
          payRate: 160,
          travelMinutes: 22,
          fitExplanation: data.explanation ?? "Demo offer — connect API for live shifts.",
        });
      }
    } catch {
      setOffer({
        roleType: "Supply Teacher",
        siteName: "Greenfield Primary",
        payRate: 160,
        travelMinutes: 22,
        fitExplanation: "Demo mode — start API to load real offers.",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleSwipe(direction: "accept" | "decline") {
    setMessage(direction === "accept" ? "Shift accepted ✓" : "Passed");
    setOffer(null);
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
            <Text style={styles.pay}>£{offer.payRate}/day</Text>
            <Text style={styles.meta}>{offer.travelMinutes} min travel</Text>
            <Text style={styles.fit}>{offer.fitExplanation}</Text>
            <View style={styles.actions}>
              <Pressable style={[styles.btn, styles.decline]} onPress={() => handleSwipe("decline")}>
                <Text style={styles.btnText}>Pass</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.accept]} onPress={() => handleSwipe("accept")}>
                <Text style={styles.btnText}>Accept</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.loadBtn} onPress={loadOffer}>
            <Text style={styles.loadBtnText}>Load next offer</Text>
          </Pressable>
        )}
      </View>

      {message && <Text style={styles.message}>{message}</Text>}
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
  meta: { color: "#94a3b8", marginTop: 8 },
  fit: { color: "#cbd5e1", marginTop: 16, lineHeight: 22 },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
  btn: { flex: 1, padding: 14, borderRadius: 10, alignItems: "center" },
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
});

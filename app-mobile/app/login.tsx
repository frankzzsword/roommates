import { Redirect } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/src/components/ActionButton";
import { AppScreen } from "@/src/components/Screen";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { TextField } from "@/src/components/TextField";
import { useHousehold } from "@/src/context/HouseholdContext";
import { colors, spacing } from "@/src/theme";

export default function LoginScreen() {
  const { isAuthenticated, login, syncNotice } = useHousehold();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Roommate login"
        title="Sign in to your house view"
        subtitle="Each roommate gets their own task list, stats, leaderboard position, weekly board, and action buttons."
      />

      <SectionCard
        title="Login"
        subtitle="This is convenience-only access for the flat, not real security."
        tone="accent"
      >
        <TextField label="Name" onChangeText={setName} placeholder="Varun" value={name} />
        <TextField
          label="Password"
          onChangeText={setPassword}
          placeholder="varun123"
          secureTextEntry
          value={password}
        />
        <ActionButton
          busy={busy}
          label="Open my house view"
          onPress={() => {
            setBusy(true);
            void login(name, password).finally(() => setBusy(false));
          }}
        />
        {syncNotice ? <Text style={styles.notice}>{syncNotice}</Text> : null}
      </SectionCard>

      <SectionCard
        title="Example passwords"
        subtitle="Simple on purpose so everyone can get in quickly."
      >
        <View style={styles.credentialRow}>
          <Text style={styles.credentialName}>Varun</Text>
          <Text style={styles.credentialPassword}>varun123</Text>
        </View>
        <View style={styles.credentialRow}>
          <Text style={styles.credentialName}>Mayssa</Text>
          <Text style={styles.credentialPassword}>mayssa123</Text>
        </View>
        <View style={styles.credentialRow}>
          <Text style={styles.credentialName}>Noah</Text>
          <Text style={styles.credentialPassword}>noah123</Text>
        </View>
        <View style={styles.credentialRow}>
          <Text style={styles.credentialName}>Julia</Text>
          <Text style={styles.credentialPassword}>julia123</Text>
        </View>
        <View style={styles.credentialRow}>
          <Text style={styles.credentialName}>Tracy</Text>
          <Text style={styles.credentialPassword}>tracy123</Text>
        </View>
        <View style={styles.credentialRow}>
          <Text style={styles.credentialName}>Maria</Text>
          <Text style={styles.credentialPassword}>maria123</Text>
        </View>
      </SectionCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  notice: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  credentialRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.xs
  },
  credentialName: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  credentialPassword: {
    color: colors.accentStrong,
    fontSize: 15,
    fontWeight: "800"
  }
});

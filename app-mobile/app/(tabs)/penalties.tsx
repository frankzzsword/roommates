import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMemo, useState } from "react";

import { ActionButton } from "@/src/components/ActionButton";
import { AppScreen } from "@/src/components/Screen";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { TextField } from "@/src/components/TextField";
import { getScoreboard } from "@/src/data/mock";
import { useHousehold } from "@/src/context/HouseholdContext";
import { colors, radii, spacing } from "@/src/theme";

export default function MoneyScreen() {
  const { activeRoommate, snapshot, createExpense, settleBalance } = useHousehold();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [includedRoommateIds, setIncludedRoommateIds] = useState<string[]>(
    snapshot.roommates.map((roommate) => roommate.id)
  );
  const [busy, setBusy] = useState(false);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);

  const myBalances = useMemo(
    () =>
      snapshot.balances.filter(
        (balance) =>
          balance.fromRoommateId === activeRoommate.id || balance.toRoommateId === activeRoommate.id
      ),
    [activeRoommate.id, snapshot.balances]
  );
  const myExpenses = useMemo(
    () =>
      snapshot.expenses.filter(
        (expense) =>
          expense.paidByRoommateId === activeRoommate.id ||
          expense.shares.some((share) => share.roommateId === activeRoommate.id)
      ),
    [activeRoommate.id, snapshot.expenses]
  );
  const scoreboard = useMemo(() => getScoreboard(snapshot), [snapshot]);

  function toggleIncluded(roommateId: string) {
    setIncludedRoommateIds((current) =>
      current.includes(roommateId)
        ? current.filter((id) => id !== roommateId)
        : [...current, roommateId]
    );
  }

  async function submitExpense() {
    const parsedAmount = Number(amount.replace(",", "."));
    if (!title.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    if (includedRoommateIds.length === 0) {
      return;
    }

    setBusy(true);
    try {
      await createExpense({
        title: title.trim(),
        amount: parsedAmount,
        includedRoommateIds,
        note: note.trim() || undefined
      });
      setTitle("");
      setAmount("");
      setNote("");
      setIncludedRoommateIds(snapshot.roommates.map((roommate) => roommate.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="House money"
        title="Shared expenses, simple settle ups"
        subtitle="Log what you bought, exclude whoever should not be part of it, and clear balances once someone pays."
      />

      <SectionCard
        title={`Add a purchase as ${activeRoommate.name}`}
        subtitle="This follows Splitwise style equal shares. Everyone selected here gets an equal cut, including you."
        tone="accent"
      >
        <TextField label="What did you buy?" onChangeText={setTitle} placeholder="Toilet paper" value={title} />
        <TextField label="Amount in euros" onChangeText={setAmount} placeholder="3.56" value={amount} />
        <TextField
          label="Optional note"
          onChangeText={setNote}
          placeholder="Bought at Aldi"
          value={note}
        />
        <View style={styles.chipWrap}>
          {snapshot.roommates.map((roommate) => {
            const selected = includedRoommateIds.includes(roommate.id);
            return (
              <Pressable
                key={roommate.id}
                onPress={() => toggleIncluded(roommate.id)}
                style={[styles.chip, selected ? styles.chipSelected : null]}
              >
                <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>
                  {selected ? "Included" : "Excluded"} {roommate.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ActionButton busy={busy} label="Add shared expense" onPress={() => void submitExpense()} />
      </SectionCard>

      <SectionCard
        title="Your settle ups"
        subtitle="These are the current simplified balances that involve you."
      >
        {myBalances.length === 0 ? (
          <Text style={styles.emptyCopy}>Nothing to settle right now.</Text>
        ) : (
          myBalances.map((balance) => {
            const youOwe = balance.fromRoommateId === activeRoommate.id;
            const counterpartyName = youOwe ? balance.toRoommateName : balance.fromRoommateName;
            const actionLabel = youOwe ? "Mark as paid" : "Mark as received";
            const actionKey = `${balance.fromRoommateId}-${balance.toRoommateId}`;

            return (
              <View key={actionKey} style={styles.balanceCard}>
                <View style={styles.balanceCopy}>
                  <Text style={styles.balanceTitle}>
                    {youOwe ? `You owe ${counterpartyName}` : `${counterpartyName} owes you`}
                  </Text>
                  <Text style={styles.balanceAmount}>{balance.amountLabel}</Text>
                </View>
                <ActionButton
                  busy={settlingKey === actionKey}
                  label={actionLabel}
                  onPress={() => {
                    setSettlingKey(actionKey);
                    void settleBalance(balance.toRoommateId, balance.amount).finally(() =>
                      setSettlingKey(null)
                    );
                  }}
                  tone={youOwe ? "primary" : "secondary"}
                />
              </View>
            );
          })
        )}
      </SectionCard>

      <SectionCard
        title="Recent shared purchases"
        subtitle="Latest expenses added to the flat ledger."
      >
        {snapshot.expenses.slice(0, 8).map((expense) => (
          <View key={expense.id} style={styles.expenseCard}>
            <View style={styles.expenseHeader}>
              <Text style={styles.expenseTitle}>{expense.title}</Text>
              <Text style={styles.expenseAmount}>{expense.amountLabel}</Text>
            </View>
            <Text style={styles.expenseMeta}>
              Paid by {expense.paidByRoommateName} • {expense.createdLabel}
            </Text>
            <Text style={styles.expenseMeta}>
              Split with {expense.shares.length} people
              {expense.excludedRoommateNames.length > 0
                ? ` • excluding ${expense.excludedRoommateNames.join(", ")}`
                : ""}
            </Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard
        title="Leaderboard"
        subtitle="The finance system does not replace the house scoreboard, so both stay visible."
      >
        {scoreboard.slice(0, 6).map((entry, index) => (
          <View key={entry.roommateId} style={styles.rankRow}>
            <View style={[styles.rankBadge, index === 0 ? styles.rankBadgeLeader : null]}>
              <Text style={styles.rankBadgeText}>{index + 1}</Text>
            </View>
            <View style={styles.rankCopy}>
              <Text style={styles.rankName}>{entry.roommateName}</Text>
              <Text style={styles.rankMeta}>
                {entry.completedCount} done • 🔥 {entry.streak} current • 🏆 {entry.bestStreak} best
              </Text>
            </View>
            <Text style={styles.rankScore}>{entry.totalScore}</Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard
        title="Your purchase history"
        subtitle="Everything you paid for or were included in."
      >
        {myExpenses.length === 0 ? (
          <Text style={styles.emptyCopy}>No expense history yet.</Text>
        ) : (
          myExpenses.map((expense) => (
            <View key={expense.id} style={styles.historyRow}>
              <View style={styles.historyCopy}>
                <Text style={styles.historyTitle}>{expense.title}</Text>
                <Text style={styles.historyMeta}>
                  {expense.paidByRoommateId === activeRoommate.id
                    ? `You paid ${expense.amountLabel}`
                    : `${expense.paidByRoommateName} paid ${expense.amountLabel}`}
                </Text>
              </View>
              <Text style={styles.historyDate}>{expense.createdLabel}</Text>
            </View>
          ))
        )}
      </SectionCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  chip: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  chipSelected: {
    backgroundColor: colors.accent
  },
  chipLabel: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800"
  },
  chipLabelSelected: {
    color: colors.white
  },
  balanceCard: {
    gap: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md
  },
  balanceCopy: {
    gap: 4
  },
  balanceTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  balanceAmount: {
    color: colors.accentStrong,
    fontSize: 24,
    fontWeight: "900"
  },
  expenseCard: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: 4
  },
  expenseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md
  },
  expenseTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900",
    flex: 1
  },
  expenseAmount: {
    color: colors.accentStrong,
    fontSize: 18,
    fontWeight: "900"
  },
  expenseMeta: {
    color: colors.muted,
    fontSize: 13
  },
  rankRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md
  },
  rankBadge: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  rankBadgeLeader: {
    backgroundColor: colors.warning
  },
  rankBadgeText: {
    color: colors.white,
    fontWeight: "900"
  },
  rankCopy: {
    flex: 1,
    gap: 2
  },
  rankName: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  rankMeta: {
    color: colors.muted,
    fontSize: 12
  },
  rankScore: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "900"
  },
  historyRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md
  },
  historyCopy: {
    flex: 1,
    gap: 2
  },
  historyTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  historyMeta: {
    color: colors.muted,
    fontSize: 12
  },
  historyDate: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14
  }
});

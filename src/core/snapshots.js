import { dedupeAccounts, indexAccounts, stableAccountKey } from './accounts.js';

function snapshotId(capturedAt) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `snapshot-${new Date(capturedAt).toISOString().replace(/[:.]/g, '-')}-${suffix}`;
}

export function createSnapshot({
  followers = [],
  following = [],
  capturedAt = Date.now(),
  source = 'manual-import',
  label = '',
  metadata = {},
} = {}) {
  return {
    id: snapshotId(capturedAt),
    capturedAt: new Date(capturedAt).toISOString(),
    source,
    label,
    followers: dedupeAccounts(followers),
    following: dedupeAccounts(following),
    metadata,
  };
}

function difference(left, rightIndex) {
  return left.filter((account) => !rightIndex.has(stableAccountKey(account)));
}

function detectRenames(previousAccounts, currentAccounts) {
  const previousById = new Map(
    previousAccounts.filter((a) => a.id).map((a) => [String(a.id), a]),
  );
  const renamed = [];
  for (const current of currentAccounts) {
    if (!current.id) continue;
    const previous = previousById.get(String(current.id));
    if (previous && previous.username !== current.username) {
      renamed.push({ id: current.id, from: previous.username, to: current.username });
    }
  }
  return renamed;
}

export function compareSnapshots(previous, current) {
  if (!previous || !current) {
    return {
      newFollowers: current?.followers || [],
      lostFollowers: [],
      newlyFollowing: current?.following || [],
      noLongerFollowing: [],
      renamed: [],
    };
  }

  const previousFollowers = indexAccounts(previous.followers);
  const currentFollowers = indexAccounts(current.followers);
  const previousFollowing = indexAccounts(previous.following);
  const currentFollowing = indexAccounts(current.following);

  return {
    newFollowers: difference(current.followers, previousFollowers),
    lostFollowers: difference(previous.followers, currentFollowers),
    newlyFollowing: difference(current.following, previousFollowing),
    noLongerFollowing: difference(previous.following, currentFollowing),
    renamed: [
      ...detectRenames(previous.followers, current.followers),
      ...detectRenames(previous.following, current.following),
    ].filter((rename, index, all) => (
      all.findIndex((entry) => entry.id === rename.id && entry.to === rename.to) === index
    )),
  };
}

export function classifyRelationships(snapshot) {
  const followers = indexAccounts(snapshot?.followers || []);
  const following = indexAccounts(snapshot?.following || []);

  const mutuals = [];
  const notFollowingBack = [];
  const iDoNotFollowBack = [];

  for (const account of following.values()) {
    if (followers.has(stableAccountKey(account))) mutuals.push(account);
    else notFollowingBack.push(account);
  }

  for (const account of followers.values()) {
    if (!following.has(stableAccountKey(account))) iDoNotFollowBack.push(account);
  }

  const sort = (items) => items.sort((a, b) => a.username.localeCompare(b.username));
  return {
    mutuals: sort(mutuals),
    notFollowingBack: sort(notFollowingBack),
    iDoNotFollowBack: sort(iDoNotFollowBack),
  };
}

export function latestSnapshot(snapshots) {
  return [...(snapshots || [])].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  )[0] || null;
}

export function previousSnapshot(snapshots, currentId) {
  const ordered = [...(snapshots || [])].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  );
  const index = ordered.findIndex((snapshot) => snapshot.id === currentId);
  return index >= 0 ? ordered[index + 1] || null : ordered[1] || null;
}

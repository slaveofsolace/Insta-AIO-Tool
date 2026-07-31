import { migrateFollowerCheckerResult } from '../migrations/follower-checker.js';
import { migrateInstagramHelperData } from '../migrations/instagram-helper.js';
import {
  inspectSimpleInstaBotLikedPhotos,
  migrateSimpleInstaBotHistory,
} from '../migrations/simpleinstabot.js';

function lowerName(name) {
  return String(name || '').replaceAll('\\', '/').toLowerCase();
}

export function inspectLegacyComponentRecord(
  { name = 'unknown.json', data, lastModified = null } = {},
) {
  const normalizedName = lowerName(name);

  if (Array.isArray(data?.allMessagesItemsArray)) {
    const migrated = migrateInstagramHelperData(data, { sourceName: name });
    return {
      component: 'instagram-helper',
      handled: true,
      messages: migrated.messages,
      legacyActions: [],
      relationshipReports: [],
      migrationReport: migrated.report,
    };
  }

  if (/liked-photos\.json$/.test(normalizedName)) {
    const migrated = inspectSimpleInstaBotLikedPhotos(data, { sourceName: name });
    return {
      component: 'simpleinstabot-liked-photos',
      handled: true,
      messages: [],
      legacyActions: [],
      relationshipReports: [],
      migrationReport: migrated.report,
    };
  }

  if (/followed\.json$/.test(normalizedName) && !/unfollowed\.json$/.test(normalizedName)) {
    const migrated = migrateSimpleInstaBotHistory(data, {
      action: 'follow',
      sourceName: name,
    });
    return {
      component: 'simpleinstabot',
      handled: true,
      messages: [],
      legacyActions: migrated.legacyActions,
      relationshipReports: [],
      migrationReport: migrated.report,
    };
  }

  if (/unfollowed\.json$/.test(normalizedName)) {
    const migrated = migrateSimpleInstaBotHistory(data, {
      action: 'unfollow',
      sourceName: name,
    });
    return {
      component: 'simpleinstabot',
      handled: true,
      messages: [],
      legacyActions: migrated.legacyActions,
      relationshipReports: [],
      migrationReport: migrated.report,
    };
  }

  if (
    Array.isArray(data?.PeopleIDontFollowBack)
    || Array.isArray(data?.PeopleNotFollowingMeBack)
  ) {
    const migrated = migrateFollowerCheckerResult(data, {
      sourceName: name,
      capturedAt: lastModified,
    });
    return {
      component: 'follower-checker',
      handled: true,
      messages: [],
      legacyActions: [],
      relationshipReports: [migrated.relationshipReport],
      migrationReport: migrated.report,
    };
  }

  return null;
}

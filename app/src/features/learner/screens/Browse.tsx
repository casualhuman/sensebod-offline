/*
 * One screen for the three browsing URLs:
 *
 *   /portal/:portalId                      portal page
 *   /portal/:portalId/:groupId             a class, audience or topic
 *   /portal/:portalId/:groupId/:seriesId   lesson list of a series
 *
 * The three routes share this component on purpose: the router then keeps it
 * mounted when a learner taps a class (portal page → class page), so the
 * page does not blank, reload or jump while the subjects appear below.
 */
import { learnerApi, useApi, type GroupDetail } from '@shared/api';
import { paths, useParams } from '@shared/router';
import { PageShell } from '@shared/shell';
import { HelpCard, Hero, LearnerStrip, NotInBag, ScreenState, SectionHeading, shellPropsFor, showsLearner } from '../components';
import { PortalIcon } from '../icons';
import { useProgress } from '../progress';
import { ClassPortal, SeriesCards, TopicPortal, WhoAreYou } from '../views/PortalViews';
import { SeriesView } from '../views/SeriesView';

/** Lesson list. Also used for a group that holds exactly one series. */
function SeriesRoute({ portalId, groupId, seriesId }: { portalId: string; groupId: string; seriesId: string }) {
  /*
   * TODO(stream-1): the group is asked for only to learn whether it has other
   * series (Back then goes to the list of series, otherwise to the portal).
   * `seriesCount` on SeriesDetail.group would save this request
   * (docs/team/REQUESTS.md). If it fails, Back falls back to the rule that
   * only classes list several series.
   */
  const { data, error, reload } = useApi(
    (signal) =>
      Promise.all([
        learnerApi.getSeries(seriesId, { signal }),
        learnerApi.getGroup(groupId, { signal }).then(
          (group) => group,
          () => null,
        ),
      ]),
    [seriesId, groupId],
  );
  const portalPath = paths.portal(portalId);
  // useApi can show the previous answer for one render after the ids change:
  // only an answer for the series in the URL counts as loaded.
  if (!data || data[0].id !== seriesId) return <ScreenState title="Lessons" backTo={portalPath} portalId={portalId} loadingLabel="Opening the lessons…" error={error} onRetry={reload} />;
  const [series, group] = data;
  // The URL must describe the series it shows: a Child protection series is
  // never drawn under another portal's address (and so without its quick exit).
  if (series.portal.id !== portalId || series.group.id !== groupId) return <NotInBag portalId={portalId} />;
  const severalSeries = group ? group.seriesCount > 1 : series.group.kind === 'class';
  return <SeriesView key={series.id} series={series} backTo={severalSeries ? paths.group(portalId, groupId) : portalPath} />;
}

/** A topic or audience that holds several series: list them (no board; the subject list pattern). */
function SeriesList({ group }: { group: GroupDetail }) {
  const { portal } = group;
  const progress = useProgress({ portalId: portal.id });
  return (
    <PageShell title={group.title} heading={group.title} backTo={paths.portal(portal.id)} listenSrc={null} {...shellPropsFor(portal.id)} theme={portal.theme}>
      <div className="sb-stack sb-stack--lg">
        <div className="sb-stack">
          <Hero description={group.description} eyebrow={portal.title} picture={group.picture} icon={<PortalIcon portalId={portal.id} size={28} />} listenSrc={null} />
          {showsLearner(portal.id) ? <LearnerStrip className="lrn-narrow" /> : null}
        </div>
        <section aria-labelledby="lrn-series" className="sb-stack">
          <SectionHeading id="lrn-series" title="Choose what to learn" />
          <SeriesCards group={group} index={showsLearner(portal.id) ? progress.index : null} />
        </section>
        {showsLearner(portal.id) ? null : <HelpCard title="Need help now?" text="See who can help you today." />}
      </div>
    </PageShell>
  );
}

function GroupRoute({ portalId, groupId }: { portalId: string; groupId: string }) {
  const { data: group, error, reload } = useApi((signal) => learnerApi.getGroup(groupId, { signal }), [groupId]);
  if (!group || group.id !== groupId) return <ScreenState title="Lessons" backTo={paths.portal(portalId)} portalId={portalId} loadingLabel="Opening the lessons…" error={error} onRetry={reload} />;
  if (group.portal.id !== portalId) return <NotInBag portalId={portalId} />;
  if (group.onlySeriesId) return <SeriesRoute portalId={portalId} groupId={groupId} seriesId={group.onlySeriesId} />;
  return <SeriesList group={group} />;
}

function PortalRoute({ portalId, groupId }: { portalId: string; groupId: string | undefined }) {
  const { data: portal, error, reload } = useApi((signal) => learnerApi.getPortal(portalId, { signal }), [portalId]);
  if (!portal || portal.id !== portalId) return <ScreenState title="Lessons" backTo={paths.home()} portalId={portalId} error={error} onRetry={reload} />;

  if (portal.groupKind === 'class') {
    if (groupId && !portal.groups.some((group) => group.id === groupId)) return <NotInBag portalId={portalId} />;
    return <ClassPortal key={portal.id} portal={portal} groupId={groupId || null} />;
  }
  if (groupId) return <GroupRoute portalId={portalId} groupId={groupId} />;
  if (portal.groupKind === 'audience') return <WhoAreYou portal={portal} />;
  return <TopicPortal key={portal.id} portal={portal} />;
}

export default function Browse() {
  const { portalId, groupId, seriesId } = useParams<'portalId' | 'groupId' | 'seriesId'>();
  if (seriesId && groupId) return <SeriesRoute portalId={portalId} groupId={groupId} seriesId={seriesId} />;
  return <PortalRoute portalId={portalId} groupId={groupId} />;
}

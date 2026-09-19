'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowUpRight, BarChart3, BookOpen, CalendarDays, CheckCircle2, Database, Globe2, LayoutDashboard, LogOut, RefreshCw, ScanLine, ShieldCheck, Users, Zap } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AdminOverview } from '@/lib/admin/types';
import { buildDemoOverview } from '@/lib/admin/demo-data';
import styles from './admin.module.css';

const number = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN');
const CATEGORY_LABELS: Record<string, string> = { electronics: '3C 电子', '3c': '3C 电子', appliance: '家电', toy: '玩具', home: '家居', battery: '电池/储能', cosmetic: '化妆品', textile: '纺织服装', food_contact: '食品接触', other: '其他' };
const categoryLabel = (value: string) => CATEGORY_LABELS[value] ?? value;
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '暂无记录';
const statusLabel = (value: string) => ({ ready: '已完成', degraded: '降级完成', unknown: '未知', fetched: '已抓取', completed: '已完成', complete: '已完成', failed: '失败', error: '异常', running: '处理中', processing: '处理中', pending: '待处理', active: '已启用', success: '成功', idle: '待抓取', disabled: '已停用' }[value.toLowerCase()] ?? '未知');
const tone = (value: string) => /fail|error|degraded/i.test(value) ? styles.bad : /complet|success|active|ready|fetched/i.test(value) ? styles.good : styles.neutral;

function Empty({ text = '当前时间范围内暂无数据' }: { text?: string }) {
  return <div className={styles.empty}><BarChart3 size={28} strokeWidth={1.4} /><p>{text}</p></div>;
}

export default function Dashboard() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [liveData, setLiveData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [metric, setMetric] = useState<'visitors' | 'apiCalls'>('visitors');
  const [refresh, setRefresh] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  // 「演示数据」为 MVP 推广预览：固定种子模拟，界面多处以琥珀色标注，
  // 每次进入默认回到真实数据。演示数据在渲染期派生（useMemo），
  // 真实数据走下方 effect 的 fetch。
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const demo = mode === 'demo';
  const demoData = useMemo(() => (demo ? buildDemoOverview(days) : null), [demo, days]);
  const data = demo ? demoData : liveData;
  const busy = !demo && loading;

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/admin/overview?days=${days}`, { cache: 'no-store', signal: controller.signal });
        if (response.status === 401) { window.location.replace('/admin/login?expired=1'); return; }
        if (!response.ok) throw new Error('暂时无法获取运营数据，请稍后重试。');
        setLiveData(await response.json() as AdminOverview);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '数据加载失败');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [days, refresh, demo]);

  const exportCsv = useCallback(() => {
    if (!data) return;
    const rows = [[demo ? '演示数据（非真实统计）· 日期' : '日期（历史UTC快照；新记录北京时间）', '独立访客', '页面访问', 'API调用', '扫描次数', '扫描完成', '扫描失败', '新增证据版本', '新增法规目录条目', '更新法规目录条目'], ...data.series.map(row => [row.date, row.visitors, row.pageViews, row.apiCalls, row.scans, row.completed, row.failed, row.fetched, row.newRegulations, row.updatedRegulations])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => value === null ? '' : `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url; link.download = `attrax-bi${demo ? '-demo' : ''}-${data.days}days-${data.generatedAt.slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  }, [data, demo]);

  async function logout() {
    setLoggingOut(true);
    try {
      const response = await fetch('/api/admin/logout', { method: 'POST' });
      if (!response.ok) throw new Error('退出失败，请重试。');
      window.location.replace('/admin/login');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '退出失败'); setLoggingOut(false); }
  }

  const totals = data?.totals;
  const trafficKnown = Boolean(data?.coverage.trafficSince);
  const scansKnown = Boolean(data?.coverage.scansSince);
  const cards = totals ? [
    { label: '独立访客', value: trafficKnown ? number(totals.visitors) : '—', suffix: '位', note: '所选周期去重匿名访客', icon: Users, color: 'blue' },
    { label: 'API 调用', value: trafficKnown ? number(totals.apiCalls) : '—', suffix: '次', note: '所选周期服务请求', icon: Zap, color: 'teal' },
    { label: '合规扫描', value: scansKnown ? number(totals.scans) : '—', suffix: '次', note: scansKnown ? `${number(totals.completed)} 次完成 · ${number(totals.failed)} 次失败` : '尚无可用的扫描记录', icon: ScanLine, color: 'violet' },
    { label: '法规目录总量', value: number(totals.regulations), suffix: '条', note: `所选周期新增 ${number(totals.newRegulations)} 条`, icon: BookOpen, color: 'amber' },
  ] : [];
  const tip = { contentStyle: { borderRadius: 12, border: '1px solid #d3e8ef', color: '#173f52', background: '#fff', fontSize: 12 }, labelStyle: { fontWeight: 600 }, cursor: { stroke: '#a7c7d5' } };

  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <Link href="/admin" className={styles.brand}><span className={styles.brandIcon}><Activity size={23} /></span><span>规航 AI<span className={styles.brandSub}>运营管理中心</span></span></Link>
      <div className={styles.navLabel}>工作空间</div>
      <nav className={styles.nav} aria-label="管理导航"><a href="#overview" className={styles.navActive}><LayoutDashboard size={18} />运营概览<span className={styles.navDot} /></a><a href="#traffic"><Activity size={18} />服务使用</a><a href="#regulations"><BookOpen size={18} />法规资产</a><a href="#scans"><ScanLine size={18} />扫描记录</a><a href="#sources"><Database size={18} />抓取来源</a></nav>
      <div className={styles.sidebarBottom}><div className={styles.adminIdentity}><span><ShieldCheck size={19} /></span><div>管理员<span>受保护的运营工作空间</span></div></div><Link href="/"><ArrowLeft size={16} />返回前台<ArrowUpRight size={14} /></Link><button onClick={logout} disabled={loggingOut}><LogOut size={16} />{loggingOut ? '正在退出…' : '退出登录'}</button></div>
    </aside>
    <main className={styles.main} id="overview">
      <div className={styles.breadcrumb}>工作空间<span>/</span><strong>运营概览</strong>{demo && <span className={`${styles.privateLabel} ${styles.demoLabel}`}><BarChart3 size={13} />演示数据</span>}<span className={styles.privateLabel}><ShieldCheck size={13} />管理员专属</span></div>
      <header className={styles.header}><div><div className={styles.eyebrow}>SERVICE INTELLIGENCE</div><h1>让每一次服务，都清晰可见。</h1><p>用户访问、服务调用与法规更新的运营全景。</p></div><div className={styles.headerActions}><div className={styles.segment} aria-label="数据来源">{([['live', '真实数据'], ['demo', '演示数据']] as const).map(([value, label]) => <button key={value} aria-pressed={mode === value} className={mode === value ? styles.selected : ''} onClick={() => setMode(value)}>{label}</button>)}</div><button className={styles.iconButton} aria-label="刷新数据" title={demo ? '演示数据为固定模拟，无需刷新' : '刷新数据'} disabled={busy || demo} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={17} className={busy ? styles.spin : ''} /></button><button className={styles.exportButton} onClick={exportCsv} disabled={!data || busy || data.days !== days}><ArrowDownToLine size={16} />导出数据</button></div></header>
      <div className={styles.toolbar}><div className={demo ? styles.liveDemo : styles.live}><span />{demo ? '演示数据 · 非真实统计' : busy ? '正在更新数据' : data ? `更新于 ${stamp(data.generatedAt)}` : '等待数据'}{!demo && <span className={styles.timezone}>北京时间</span>}</div><div className={styles.dateControl}><CalendarDays size={16} /><span>统计周期</span><div className={styles.segment} aria-label="统计天数">{([7, 30, 90] as const).map(value => <button key={value} aria-pressed={days === value} className={days === value ? styles.selected : ''} onClick={() => setDays(value)}>近 {value} 天</button>)}</div></div></div>
      {error && <div className={styles.error} role="alert"><span>{error}</span><button onClick={() => setRefresh(value => value + 1)}>重新加载</button></div>}
      {busy && !data && <div className={styles.loading} role="status"><RefreshCw size={22} className={styles.spin} /><p>正在读取真实运营数据…</p></div>}
      {data && totals && <div className={busy ? styles.refreshing : undefined} aria-busy={busy}>
        <section className={styles.cards} aria-label="核心指标">{cards.map(card => <article className={styles.card} key={card.label}><div className={styles.cardTop}><span>{card.label}</span><span className={`${styles.metricIcon} ${styles[card.color]}`}><card.icon size={18} /></span></div><div className={styles.cardValue}>{card.value}<span>{card.suffix}</span></div><p>{card.note}</p></article>)}</section>
        <div className={styles.chartGrid}>
          <section className={styles.panel} id="traffic"><div className={styles.panelHeader}><div><h2>服务使用趋势</h2><p>观察每日访问与服务请求的变化</p></div><div className={styles.segment}>{(['visitors', 'apiCalls'] as const).map(value => <button key={value} aria-pressed={metric === value} className={metric === value ? styles.selected : ''} onClick={() => setMetric(value)}>{value === 'visitors' ? '独立访客' : 'API 调用'}</button>)}</div></div><div className={styles.chart}>{data.series.some(row => row[metric] !== null) ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={data.series} margin={{ top: 12, right: 12, bottom: 0, left: -18 }}><defs><linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#279fb3" stopOpacity={0.28} /><stop offset="100%" stopColor="#279fb3" stopOpacity={0.015} /></linearGradient></defs><CartesianGrid stroke="#deebef" vertical={false} strokeDasharray="4 4" /><XAxis dataKey="date" tickFormatter={value => value.slice(5)} tickLine={false} axisLine={false} minTickGap={32} tick={{ fill: '#78919b', fontSize: 11 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#78919b', fontSize: 11 }} /><Tooltip {...tip} /><Area type="monotone" dataKey={metric} name={metric === 'visitors' ? '独立访客' : 'API 调用'} stroke="#1595aa" strokeWidth={2.5} fill="url(#trafficFill)" connectNulls={false} dot={{ r: 2 }} activeDot={{ r: 5 }} /></AreaChart></ResponsiveContainer> : <Empty text="访问统计尚未开始记录" />}</div><div className={styles.chartFoot}><span className={styles.legendDot} />{metric === 'visitors' ? '每日匿名独立访客' : '每日 API 请求数'}<span>空缺日期表示尚无记录</span></div></section>
          <section className={styles.panel} id="regulations"><div className={styles.panelHeader}><div><h2>法规每日更新</h2><p>新增目录条目与证据版本，详细日期口径见下方说明</p></div><BookOpen size={18} className={styles.mutedIcon} /></div><div className={styles.chart}>{data.series.some(row => row.fetched !== null || row.newRegulations !== null) ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data.series} margin={{ top: 12, right: 10, bottom: 0, left: -18 }}><CartesianGrid stroke="#deebef" vertical={false} strokeDasharray="4 4" /><XAxis dataKey="date" tickFormatter={value => value.slice(5)} tickLine={false} axisLine={false} minTickGap={32} tick={{ fill: '#78919b', fontSize: 11 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#78919b', fontSize: 11 }} /><Tooltip {...tip} /><Bar dataKey="fetched" name="新增证据版本" fill="#b3893a" radius={[3, 3, 0, 0]} maxBarSize={16} /><Bar dataKey="newRegulations" name="新增目录条目" fill="#279fb3" radius={[3, 3, 0, 0]} maxBarSize={16} /></BarChart></ResponsiveContainer> : <Empty text="当前没有可用的法规抓取历史" />}</div><div className={styles.chartFoot}><span className={styles.legendDot} />新增目录条目<span className={styles.secondaryDot} />新增证据版本<span>按日统计</span></div></section>
        </div>
        <div className={styles.detailGrid}>
          <section className={styles.panel}><div className={styles.panelHeader}><div><h2>法规市场分布</h2><p>当前法规目录覆盖范围</p></div><Globe2 size={18} className={styles.mutedIcon} /></div><div className={styles.marketSummary}><strong>{number(totals.markets)}</strong><span>个市场</span><span className={styles.pill}>{number(totals.regulations)} 条法规目录</span></div><div className={styles.markets}>{data.markets.length ? data.markets.map(market => <div key={market.name} className={styles.marketRow}><div><span><i />{market.name}</span><strong>{number(market.count)}<small>{totals.regulations ? Math.round(market.count / totals.regulations * 100) : 0}%</small></strong></div><div className={styles.track}><span style={{ width: `${totals.regulations ? market.count / totals.regulations * 100 : 0}%` }} /></div></div>) : <Empty text="尚无法规市场记录" />}</div></section>
          <section className={styles.panel} id="scans"><div className={styles.panelHeader}><div><h2>近期合规扫描</h2><p>所选周期的最新扫描任务</p></div><span className={styles.pill}>{scansKnown ? `${number(totals.scans)} 次扫描` : '尚未采集'}</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>扫描编号</th><th>业务类别</th><th>状态</th><th>耗时</th><th>创建时间</th></tr></thead><tbody>{data.recentScans.map(scan => <tr key={scan.id}><td className={styles.mono} title={scan.id}>{scan.id.slice(0, 12)}</td><td>{scan.category || '未分类'}</td><td><span className={`${styles.status} ${tone(scan.status)}`}>{statusLabel(scan.status)}</span></td><td>{scan.latencyMs === null ? '—' : `${(scan.latencyMs / 1000).toFixed(1)} 秒`}</td><td className={styles.nowrap}>{stamp(scan.timestamp)}</td></tr>)}</tbody></table>{!data.recentScans.length && <Empty text="所选周期内暂无扫描记录" />}</div>{data.categories.length > 0 && <div className={styles.categoryRow}><span className={styles.categoryLabel}>品类分布</span>{data.categories.map(item => <span className={styles.pill} key={item.name}>{categoryLabel(item.name)} · {number(item.count)}</span>)}</div>}<div className={styles.tableFoot}><CheckCircle2 size={14} />完成 {scansKnown ? number(totals.completed) : '—'} 次<span>平均耗时 {totals.averageLatencyMs === null ? '—' : `${(totals.averageLatencyMs / 1000).toFixed(1)} 秒`}</span></div></section>
        </div>
        <section className={styles.panel} id="sources"><div className={styles.panelHeader}><div><h2>法规抓取来源</h2><p>已配置来源的最近抓取状态</p></div><span className={styles.pill}><Database size={13} />{number(totals.sources)} 个来源</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>法规来源</th><th>目标市场</th><th>当前状态</th><th>最近抓取</th></tr></thead><tbody>{data.sources.map(source => <tr key={source.id}><td><span className={styles.sourceTitle}>{source.title}</span></td><td>{source.market || '未分类'}</td><td><span className={`${styles.status} ${tone(source.status)}`}>{statusLabel(source.status)}</span></td><td className={styles.nowrap}>{stamp(source.lastFetchedAt)}</td></tr>)}</tbody></table>{!data.sources.length && <Empty text="尚未配置法规抓取来源" />}</div></section>
        <section className={styles.notes}><div><ShieldCheck size={17} /><h2>数据口径与覆盖范围</h2></div><p>服务当前没有注册账户体系。「独立访客」按页面访问的匿名访客标识统计，不能等同于注册用户；清除 Cookie 或更换设备会产生新的标识。每日去重人数之和可能大于周期去重人数。API 调用统计服务请求尝试，包含轮询和错误请求，不代表大模型调用次数。</p><p>法规数量按目录条目统计；新增证据版本按抓取元数据的哈希记录统计，不代表实际文件数量。历史快照按 UTC 日期归档，新采集记录按北京时间归档，跨来源的每日数据存在日期口径差异。</p><p>访问数据起始：{data.coverage.trafficSince ? stamp(data.coverage.trafficSince) : '尚无访问记录'}；扫描记录起始：{data.coverage.scansSince ? stamp(data.coverage.scansSince) : '尚无扫描记录'}。历史未记录数据以空缺显示；导出 CSV 中相应单元格留空。</p>{data.coverage.notes.map((note, index) => <p key={index}>{note}</p>)}</section>
      </div>}
      <footer className={styles.footer}><span>规航 AI · 合规服务运营中心</span><span>数据仅供授权管理员使用</span><button onClick={logout} disabled={loggingOut}>{loggingOut ? '正在退出…' : '退出登录'}</button></footer>
    </main>
  </div>;
}

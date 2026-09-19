'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Activity, ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import styles from './admin.module.css';

export default function LoginForm() {
  // Dashboard 在会话失效时跳转 /admin/login?expired=1；页面是 force-dynamic，
  // useSearchParams 不需要 Suspense 边界。
  const expired = useSearchParams().get('expired');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(expired ? '登录状态已过期，请重新输入管理员密码。' : '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError('');
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error(response.status === 429 ? '尝试次数过多，请稍后重试。' : response.status === 401 ? '管理员密码不正确。' : response.status === 503 ? '管理员访问尚未配置，请联系服务维护人员。' : '暂时无法登录，请稍后重试。');
      window.location.replace('/admin');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败，请重试。'); setPending(false); }
  }

  return <main className={styles.loginPage}><Link href="/" className={styles.loginBack}><ArrowLeft size={16} />返回 ATTRAX</Link><section className={styles.loginCard}><div className={styles.loginBrand}><Activity size={27} /></div><div className={styles.eyebrow}>ATTRAX ADMIN</div><h1>运营管理中心</h1><p className={styles.loginIntro}>查看服务使用情况与法规资产动态。</p><form onSubmit={submit}><label htmlFor="admin-password">管理员密码</label><div className={styles.passwordField}><LockKeyhole size={18} /><input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="输入管理员密码" disabled={pending} /></div>{error && <p className={styles.loginError} role="alert">{error}</p>}<button className={styles.loginSubmit} type="submit" disabled={pending || !password}>{pending ? '正在验证…' : '进入管理后台'}<ArrowRight size={17} /></button></form><div className={styles.loginNote}><ShieldCheck size={15} />此工作空间仅限已授权的管理员访问</div></section><div className={styles.loginFooter}>ATTRAX · 合规服务运营中心</div></main>;
}

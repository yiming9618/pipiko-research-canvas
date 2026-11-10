// Placeholder shell for stage 0. The real home page arrives in stage 2.
export default function App() {
  return (
    <main className="shell">
      <p className="shell-date">{new Date().toLocaleDateString('zh-CN')}</p>
      <h1>欢迎回来</h1>
      <p className="shell-note">研究笔记本正在搭建中</p>
    </main>
  )
}

import { Component, type ReactNode } from 'react'
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <main role="alert"><h1>画面を表示できません / Unable to display the page</h1><p>再読み込みしてください / Please reload.</p></main> : this.props.children
  }
}

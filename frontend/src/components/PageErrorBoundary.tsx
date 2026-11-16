import { Component, type ErrorInfo, type ReactNode } from 'react';
import { api } from '../api';

// 화면별 오류 경계(2026-11-16) — 예전엔 렌더 중 오류 하나가 앱 전체를 흰 화면으로 만들었다. App.tsx가 한 번 연 화면을
// 숨겨 둔 채 계속 렌더하므로(화면 유지) 숨은 화면의 오류도 전체를 멈췄다. 이제 그 화면 자리만 안내로 바뀌고 메뉴·다른 화면은
// 그대로 쓸 수 있다. "다시 불러오기"는 그 화면을 새로 마운트한다(상태를 버리고 처음부터).
// 오류 내용은 백엔드 로그 파일에도 남긴다(가려서 — electron/src/logging.ts) — 사용자가 "로그 폴더 열기"로 첨부할 수 있게.

interface Props {
  page: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  generation: number;
}

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void api
      .reportClientError({ page: this.props.page, message: error.message, stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` })
      .catch(() => {});
  }

  private retry = () => {
    this.setState((s) => ({ error: null, generation: s.generation + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>이 화면을 표시하다 오류가 났습니다</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            다른 메뉴는 그대로 쓸 수 있습니다. 다시 불러와도 같으면 정보 화면의 <strong>로그 폴더 열기</strong>로 로그 파일을 확인하거나
            문의할 때 첨부해 주세요.
          </p>
          <p className="text-critical" style={{ fontSize: 12 }}>
            {this.state.error.message}
          </p>
          <button className="primary" onClick={this.retry}>
            다시 불러오기
          </button>
        </div>
      );
    }
    return <div key={this.state.generation}>{this.props.children}</div>;
  }
}

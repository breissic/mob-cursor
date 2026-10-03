import type { CSSProperties, ReactNode } from 'react';

/** A MobOS 95 window: chunky outline, hard shadow, colored title bar. */
export function Win(props: {
  title: ReactNode;
  color?: string;
  icon?: string;
  right?: ReactNode;
  className?: string;
  bodyClass?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section className={`win ${props.className ?? ''}`} style={{ ...props.style, ['--bar' as string]: props.color ?? '#ffd23f' }}>
      <header className="win-bar">
        {props.icon && <img className="win-icon" src={props.icon} alt="" />}
        <span className="win-title">{props.title}</span>
        <span className="win-right">{props.right}</span>
        <span className="win-btns" aria-hidden>
          <i>_</i>
          <i>□</i>
          <i>×</i>
        </span>
      </header>
      <div className={`win-body ${props.bodyClass ?? ''}`}>{props.children}</div>
    </section>
  );
}

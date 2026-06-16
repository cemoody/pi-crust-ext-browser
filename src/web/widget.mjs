/**
 * pi-crust web module: the canvas live-browser viewer (sidebar activity + inline
 * card). Exports `renderActivity(props)` per the host's ExternalWebActivity
 * contract. React is provided by the host via props.React.
 *
 * Scaffold: renders a placeholder until the canvas renderer + browser:* socket
 * client land (see test/widget/widget.test.ts ids STR/INP/HOFF-6/RVL).
 */
export function renderActivity(props) {
  const React = props.React;
  return React.createElement(
    'div',
    { style: { padding: 16, font: '13px system-ui', opacity: 0.8 } },
    React.createElement('b', null, '🌐 Browser'),
    React.createElement('p', null, 'Live remote-browser viewer — coming soon.'),
  );
}

export default renderActivity;

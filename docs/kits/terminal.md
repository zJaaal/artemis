[Back to the README](../../README.md)

# Terminal: `@zjaaal/artemis/terminal`

Describe terminal tabs as data and let an adapter open them. Only Warp is supported for now.

```js
import { openTabs, warp } from '@zjaaal/artemis/terminal';

openTabs(warp(), [
    {
        id: 'demo',
        name: 'demo',
        panes: [
            { dir: '/work/demo', run: ['art up'] },
            { dir: '/work/demo', run: ['art wait'], focus: true }
        ]
    }
]);
```

- A tab is `{ id, name, title?, color?, panes }`: a flat list of panes laid out left to right. Its `id` is a plain word (letters, digits, `-` and `_`), because it becomes a file name and part of a link.
- Instead of `panes`, a tab can take a `layout`: a tree of splits, `{ split: 'horizontal' | 'vertical', children: [pane | split, ...] }` (`horizontal` is side by side, `vertical` is stacked).
- A pane is `{ dir, run?: string[], focus? }`.
- `warp({ configDir, open })` writes each tab as a Warp Tab Config and opens it through its `warp://` link. Both options are injectable, which is how you test it.

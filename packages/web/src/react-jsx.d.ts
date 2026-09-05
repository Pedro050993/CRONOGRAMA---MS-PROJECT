/**
 * React 19 deixou de publicar o namespace global `JSX`; ele passou a viver em
 * `React.JSX`. Este arquivo reexpoe o namespace global para que os componentes
 * possam anotar o retorno como `JSX.Element` sem importar React em cada arquivo.
 */
import type * as React from 'react';

declare global {
  namespace JSX {
    type Element = React.JSX.Element;
    type ElementType = React.JSX.ElementType;
    type ElementClass = React.JSX.ElementClass;
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}

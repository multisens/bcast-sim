# bcast-sim

A emissora simulada do testbed de Codificação de Aplicações da TV 3.0, fora da plataforma. Ela serve
por HTTP a sinalização da camada de transporte de cada serviço, os arquivos dos serviços e o vídeo ao
vivo, a partir das declarações de uma pasta de emissão. `example/` traz uma pasta sintética.

Este repositório é submódulo do [TV30](https://github.com/multisens/TV30) e sobe pelo
`docker-compose.yml` da raiz dele.

**Documentação:** <https://multisens.com.br/TV30/emissora-simulada/>

## Desenvolver e testar

- Declarar serviços, preparar o vídeo, variáveis de ambiente e partes do código:
  [Emissora simulada](https://multisens.com.br/TV30/emissora-simulada/).
- Pôr uma aplicação no ar numa pasta de emissão própria:
  [Pôr uma app de emissora no ar](https://multisens.com.br/TV30/por-app-de-emissora-no-ar/).
- Testes: `npm test` e `npx tsc --noEmit`; as suítes com a stack de pé estão em
  [Como testar](https://multisens.com.br/TV30/como-testar/).

## Licença

Apache-2.0; veja o `LICENSE`.

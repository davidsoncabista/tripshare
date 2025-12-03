Contribuindo para o TripShare 🚀

Obrigado pelo interesse em contribuir para o ecossistema TripShare! Este documento fornece diretrizes para contribuir com o projeto.

## 🛠️ Stack Tecnológica

Antes de começar, certifique-se de estar familiarizado com a nossa arquitetura:

* **Infraestrutura:** Proxmox LXC, Docker, Nginx Gateway.
* **Backend:** Node.js (Express), Socket.io.
* **Dados:** PostgreSQL (PostGIS), Redis.
* **Geo:** OSRM (Open Source Routing Machine).
* **Mobile:** React Native (Expo).

## 🚀 Como Rodar o Projeto Localmente

1. **Clone o repositório**
   ```bash
   git clone [https://github.com/davidsoncabista/tripshare.git](https://github.com/davidsoncabista/tripshare.git) 
   ```
2. **Configure as Variáveis de Ambiente**
Copie o ficheiro .env.example para .env e preencha com as suas credenciais locais ou do ambiente de desenvolvimento.

3.**Inicie os Containers (Se estiver a usar Docker)**
```
Bash

cd infra
./install_redis.sh # (Exemplo de script de provisionamento)
Inicie o Backend
```
```
Bash

cd backend
npm install
npm start
```
## 🤝 Processo de Pull Request
1.Faça um Fork deste repositório.

2.Crie uma branch para a sua feature (git checkout -b feature/MinhaFeature).

3.Faça o commit das suas alterações seguindo o padrão Conventional Commits (ex: feat: adiciona login, fix: corrige rota).

4.Faça o push para a branch (git push origin feature/MinhaFeature).

5.Abra um Pull Request.

## 🐛 Reportar Bugs
.Se encontrar um bug, por favor abra uma Issue detalhando:

* O comportamento esperado.

* O comportamento atual.

* Passos para reproduzir o erro.

* Screenshots ou logs do terminal.

### Desenvolvido por Davidson S Conceição.
terraform {
  required_providers {
    proxmox = {
      source  = "telmate/proxmox"
      version = "2.9.14"
    }
  }
}

provider "proxmox" {
  # ⚠️ AJUSTE AQUI: O IP do seu Proxmox
  pm_api_url = "https://192.168.0.99:8006/api2/json"

  # ⚠️ AJUSTE AQUI: Use o Token que você gerou OU usuário/senha
  # pm_api_token_id     = "root@pam!terraform"
  # pm_api_token_secret = "seu-token-aqui"
  
  # Modo simples (usuário/senha) para testar agora:
  pm_user     = "root@pam"
  pm_password = "sua_senha_proxmox"
  
  pm_tls_insecure = true
}

resource "proxmox_lxc" "k3s_master" {
  target_node  = "pve"
  hostname     = "k3s-master"
  
  # ✅ AQUI ESTÁ A CORREÇÃO BASEADA NA SUA IMAGEM:
  # O formato é sempre: storage:vztmpl/nome_do_arquivo
  ostemplate   = "local:vztmpl/ubuntu-25.04-standard_25.04-1.1_amd64.tar.zst"
  
  password     = "senha123"
  unprivileged = true
  start        = true

  # Recursos (K3s exige um pouco mais)
  cores  = 2
  memory = 4096
  swap   = 512

  # Rede (IP final .60 para o Master do Kubernetes)
  network {
    name   = "eth0"
    bridge = "vmbr0"
    ip     = "192.168.0.60/24"
    gw     = "192.168.0.1"
  }

  # Funcionalidades CRÍTICAS para rodar Kubernetes/Docker no LXC
  features {
    nesting = true
    fuse    = true
    keyctl  = true
  }

  # Conexão para rodar comandos pós-instalação
  connection {
    type     = "ssh"
    user     = "root"
    password = "senha123"
    host     = "192.168.0.60"
  }

  # Instala o curl para podermos baixar o K3s depois
  provisioner "remote-exec" {
    inline = [
      "apt update",
      "apt install -y curl"
    ]
  }
}
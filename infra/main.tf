# MediAssist staging environment, described as code.
# Runs the site's web server (nginx) as a Docker container on the local machine,
# so no cloud account is needed.

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

# Talks to the local Docker engine. Set DOCKER_HOST if Docker is not at its default socket.
provider "docker" {}

# Pull the nginx web-server image.
resource "docker_image" "nginx" {
  name         = "nginx:1.27-alpine"
  keep_locally = false
}

# Run it as the staging container: port 80 inside -> port 8080 on this machine.
resource "docker_container" "staging" {
  name  = "scm-staging"
  image = docker_image.nginx.image_id

  ports {
    internal = 80
    external = 8080
  }
}

output "container_name" {
  value = docker_container.staging.name
}

output "url" {
  value = "http://localhost:8080"
}

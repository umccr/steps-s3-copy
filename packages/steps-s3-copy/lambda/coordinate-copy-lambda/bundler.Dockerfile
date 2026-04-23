FROM public.ecr.aws/sam/build-nodejs22.x:latest
RUN npm install --global --unsafe-perm bun esbuild

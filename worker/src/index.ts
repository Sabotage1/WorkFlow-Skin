export default {
  fetch(): Response {
    return Response.json(
      { error: "not_found", message: "Not found" },
      { status: 404 }
    );
  }
} satisfies ExportedHandler<Env>;

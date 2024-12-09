
build :: () {
  // Don't output anything
  set_build_options_dc(.{do_output=false, write_added_strings=false});

  w := compiler_create_workspace();
  if !w 
  {
    log("Workspace creation failed.\n", flags=.ERROR);
    return;
  }
  w = w;

  // Set build options
  {
    options := get_build_options(w);
    // options.output_type = .NO_OUTPUT;
    options.output_executable_name = "leak_autorun";
    options.output_path = ".build/";
    options.text_output_flags = 0;
    set_build_options(options, w);
  }

  plugins_to_use: [..] string;
  plugins_to_use.allocator = temp;
  plugins: [..] *Metaprogram_Plugin;
  plugins.allocator = temp;
  array_add(*plugins_to_use, "Autorun");
  init_plugins(plugins_to_use, *plugins, w);

  // Message Loop
  {
    flags: Intercept_Flags;
    for plugins if it.before_intercept it.before_intercept(it, *flags);
    compiler_begin_intercept(w, flags);
    for plugins if it.add_source it.add_source(it);

    add_build_string("main :: () {}", w);

    while true 
    {
      message := compiler_wait_for_message();

      if w != message.workspace continue;
      for plugin: plugins 
      {
        if plugin.message plugin.message(plugin, message);
      }

      if message.kind == .COMPLETE break;
    }

    compiler_end_intercept(w);
    for plugins if it.finish   it.finish  (it);
    for plugins if it.shutdown it.shutdown(it);
  }


  reset_temporary_storage();
  report := make_leak_report();
  defer deinit(*report);

  if (report.sorted_summaries.count > 0) 
  {
    log_leak_report(report);
    assert(false);
  }
}

#run build();

#import "Basic"()(MEMORY_DEBUGGER=true);
#import "Compiler";
#import "Check";
#import "Metaprogram_Plugins";

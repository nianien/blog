var format = require('util').format;

module.exports = {
  blocks: {
    hint: {
      process: function(block) {
        var style = block.kwargs.style || 'info';
        var title = block.kwargs.title || style.charAt(0).toUpperCase() + style.slice(1);
        return format(
          '<div class="hint %s"><p class="hint-title">%s</p>\n%s\n</div>',
          style,
          title,
          this.renderBlock(block.body)
        );
      }
    }
  }
};
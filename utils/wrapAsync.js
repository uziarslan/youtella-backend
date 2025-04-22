module.exports = function wrapAsync(fn) {
    return function (req, res, next) {
        try {
            Promise.resolve(fn(req, res, next)).catch(next);
        } catch (err) {
            next(err);
        }
    };
};
